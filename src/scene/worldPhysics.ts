import * as CANNON from 'cannon-es';
import type { PhysicsGravityPreset, WorldObject, WorldPropKind } from '../types/os';
import { computeObjectMotionTransform } from '../utils/worldEnhancements';

export const GRAVITY_VALUES: Record<PhysicsGravityPreset, number> = {
  earth: -9.82,
  lunar: -1.62,
  'zero-g': 0,
};

/**
 * Returns [width, height, depth] in meters matching the visual prop geometry
 * in environments.ts (before scale multiplier).
 */
export function getPropColliderDimensions(
  kind: WorldPropKind,
  scale = 1,
): [number, number, number] {
  const s = Math.max(0.4, Math.min(3.0, Number.isFinite(scale) ? scale : 1));
  let base: [number, number, number];
  switch (kind) {
    case 'quantum-crate':
      base = [0.96, 0.96, 0.96];
      break;
    case 'workstation-desk':
      // Desk flat tabletop surface sits cleanly at 0.80m for stacking items on top!
      base = [1.75, 0.82, 0.92];
      break;
    case 'quantum-workstation':
      base = [2.45, 0.84, 1.38];
      break;
    case 'mainframe-rack':
      base = [1.22, 2.38, 0.92];
      break;
    case 'holo-terrain-table':
      base = [2.4, 0.96, 2.4];
      break;
    case 'holo-hud-terminal':
      base = [1.75, 2.15, 0.95];
      break;
    case 'arch-portal':
      base = [3.6, 3.8, 0.95];
      break;
    case 'holo-kiosk':
      base = [0.98, 1.72, 0.86];
      break;
    case 'relay-beacon':
      base = [1.04, 2.48, 1.04];
      break;
    case 'data-monolith':
      base = [0.8, 2.6, 0.42];
      break;
    case 'lounge-pod':
      base = [1.56, 0.5, 1.56];
      break;
    case 'media-screen':
      base = [2.25, 2.02, 0.95];
      break;
    case 'holo-billboard':
      base = [3.38, 2.7, 1.05];
      break;
    case 'kinetic-sculpture':
      base = [1.4, 2.2, 1.4];
      break;
    default:
      base = [1.2, 1.4, 1.2];
  }
  return [
    Number((base[0] * s).toFixed(3)),
    Number((base[1] * s).toFixed(3)),
    Number((base[2] * s).toFixed(3)),
  ];
}

/**
 * Computes the highest supporting surface Y at (x, z) across existing props
 * so newly placed or dragged objects smoothly elevate and stack on top.
 */
export function computeSupportTopY(
  x: number,
  z: number,
  excludeId: string | null,
  objects: WorldObject[],
): number {
  let topY = 0;
  for (const obj of objects) {
    if (excludeId && obj.id === excludeId) continue;
    const [w, h, d] = getPropColliderDimensions(obj.kind, obj.scale ?? 1);
    const dx = Math.abs(x - obj.position[0]);
    const dz = Math.abs(z - obj.position[2]);
    if (dx <= w * 0.58 && dz <= d * 0.58) {
      topY = Math.max(topY, (obj.position[1] ?? 0) + h);
    }
  }
  return Number(topY.toFixed(3));
}

export interface PhysicsBodyPose {
  id: string;
  position: [number, number, number];
  quaternion: [number, number, number, number];
  sleeping: boolean;
  isDynamic: boolean;
}

export interface PhysicsEngineStats {
  dynamicCount: number;
  sleepingCount: number;
  collisionCount: number;
  gravityY: number;
}

interface TrackedBody {
  data: WorldObject;
  body: CANNON.Body;
  size: [number, number, number];
  phaseOffset: number;
  wasAwake: boolean;
  dirtySettled: boolean;
  lastRemotePos: [number, number, number];
  lastRemoteRotY: number;
}

export class WorldPhysicsEngine {
  public readonly world: CANNON.World;
  private readonly defaultMaterial: CANNON.Material;
  private readonly tracked = new Map<string, TrackedBody>();
  private draggingId: string | null = null;
  private collisionEventsThisStep = 0;
  private totalElapsed = 0;

  constructor(gravityPreset: PhysicsGravityPreset = 'earth') {
    this.world = new CANNON.World({
      gravity: new CANNON.Vec3(0, GRAVITY_VALUES[gravityPreset], 0),
      allowSleep: true,
    });
    this.world.broadphase = new CANNON.SAPBroadphase(this.world);
    (this.world.solver as CANNON.GSSolver).iterations = 10;

    this.defaultMaterial = new CANNON.Material('aetherProp');
    const contactMat = new CANNON.ContactMaterial(this.defaultMaterial, this.defaultMaterial, {
      friction: 0.72,
      restitution: 0.16,
      contactEquationStiffness: 1e7,
      contactEquationRelaxation: 3,
    });
    this.world.addContactMaterial(contactMat);
    this.world.defaultContactMaterial = contactMat;

    // Ground plane at y = 0
    const groundBody = new CANNON.Body({
      type: CANNON.Body.STATIC,
      material: this.defaultMaterial,
      shape: new CANNON.Plane(),
    });
    groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
    this.world.addBody(groundBody);

    // Central Intelligence Core Pedestal static collider at (0, 0..0.78, 0)
    const corePlinth = new CANNON.Body({
      type: CANNON.Body.STATIC,
      material: this.defaultMaterial,
    });
    corePlinth.addShape(
      new CANNON.Cylinder(2.35, 2.45, 0.85, 16),
      new CANNON.Vec3(0, 0.425, 0),
    );
    this.world.addBody(corePlinth);
  }

  public setGravityPreset(preset: PhysicsGravityPreset): void {
    const g = GRAVITY_VALUES[preset] ?? -9.82;
    this.world.gravity.set(0, g, 0);
    this.wakeAll();
  }

  public wakeAll(): void {
    for (const entry of this.tracked.values()) {
      entry.body.wakeUp();
      if (this.world.gravity.y === 0 && entry.body.type === CANNON.Body.DYNAMIC) {
        // Gentle float impulse in Zero-G mode
        entry.body.velocity.y += 0.15;
      }
    }
  }

  private buildBodyForObject(obj: WorldObject): { body: CANNON.Body; size: [number, number, number] } {
    const size = getPropColliderDimensions(obj.kind, obj.scale ?? 1);
    const [w, h, d] = size;
    const isKinematic = Boolean(obj.motion && obj.motion !== 'static');
    const mass = isKinematic ? 0 : Math.max(8, Math.min(85, w * h * d * 10));

    const body = new CANNON.Body({
      mass,
      type: isKinematic ? CANNON.Body.KINEMATIC : CANNON.Body.DYNAMIC,
      material: this.defaultMaterial,
      linearDamping: 0.28,
      angularDamping: 0.65,
      sleepSpeedLimit: 0.12,
      sleepTimeLimit: 0.45,
    });
    // Weighted bottom-center pivot so group.position === body.position directly
    // and tall structures tilt realistically without wildly flipping upside down
    body.angularFactor.set(0.42, 1.0, 0.42);

    const shape = new CANNON.Box(new CANNON.Vec3(w * 0.5, h * 0.5, d * 0.5));
    body.addShape(shape, new CANNON.Vec3(0, h * 0.5, 0));

    body.position.set(obj.position[0], Math.max(0, obj.position[1] ?? 0), obj.position[2]);
    body.quaternion.setFromEuler(0, obj.rotationY || 0, 0);

    body.addEventListener('collide', () => {
      this.collisionEventsThisStep++;
    });

    return { body, size };
  }

  public syncObjects(objects: WorldObject[]): void {
    const seen = new Set<string>();
    let structureChanged = false;

    objects.forEach((obj, idx) => {
      seen.add(obj.id);
      const existing = this.tracked.get(obj.id);
      const nextSize = getPropColliderDimensions(obj.kind, obj.scale ?? 1);
      const isKinematic = Boolean(obj.motion && obj.motion !== 'static');

      if (!existing) {
        const { body, size } = this.buildBodyForObject(obj);
        this.world.addBody(body);
        this.tracked.set(obj.id, {
          data: obj,
          body,
          size,
          phaseOffset: idx * 1.15,
          wasAwake: true,
          dirtySettled: !isKinematic && (obj.position[1] ?? 0) > 0.02,
          lastRemotePos: [obj.position[0], obj.position[1] ?? 0, obj.position[2]],
          lastRemoteRotY: obj.rotationY,
        });
        structureChanged = true;
      } else {
        const sizeChanged =
          Math.abs(existing.size[0] - nextSize[0]) > 0.02 ||
          Math.abs(existing.size[1] - nextSize[1]) > 0.02 ||
          Math.abs(existing.size[2] - nextSize[2]) > 0.02;
        const motionChanged =
          (existing.data.motion || 'static') !== (obj.motion || 'static');

        if (sizeChanged || motionChanged) {
          this.world.removeBody(existing.body);
          const { body, size } = this.buildBodyForObject(obj);
          if (!motionChanged) {
            body.position.copy(existing.body.position);
            body.quaternion.copy(existing.body.quaternion);
          }
          this.world.addBody(body);
          existing.body = body;
          existing.size = size;
          structureChanged = true;
        } else if (this.draggingId !== obj.id) {
          const remoteMoved =
            Math.abs(existing.lastRemotePos[0] - obj.position[0]) > 0.05 ||
            Math.abs(existing.lastRemotePos[1] - (obj.position[1] ?? 0)) > 0.05 ||
            Math.abs(existing.lastRemotePos[2] - obj.position[2]) > 0.05;
          if (remoteMoved) {
            const dx = Math.abs(existing.body.position.x - obj.position[0]);
            const dy = Math.abs(existing.body.position.y - (obj.position[1] ?? 0));
            const dz = Math.abs(existing.body.position.z - obj.position[2]);
            if (dx > 0.25 || dy > 0.35 || dz > 0.25) {
              existing.body.position.set(obj.position[0], Math.max(0, obj.position[1] ?? 0), obj.position[2]);
              existing.body.velocity.setZero();
              existing.body.angularVelocity.setZero();
              existing.body.wakeUp();
              existing.dirtySettled = !isKinematic && (obj.position[1] ?? 0) > 0.02;
            }
          }
          const remoteRotated = Math.abs(existing.lastRemoteRotY - obj.rotationY) > 0.02;
          if (remoteRotated && !isKinematic) {
            existing.body.quaternion.setFromEuler(0, obj.rotationY, 0);
            existing.body.angularVelocity.setZero();
            existing.body.wakeUp();
          }
        }
        existing.data = obj;
        existing.phaseOffset = idx * 1.15;
        existing.lastRemotePos = [obj.position[0], obj.position[1] ?? 0, obj.position[2]];
        existing.lastRemoteRotY = obj.rotationY;
      }
    });

    for (const [id, entry] of this.tracked.entries()) {
      if (!seen.has(id)) {
        this.world.removeBody(entry.body);
        this.tracked.delete(id);
        structureChanged = true;
      }
    }

    if (structureChanged) {
      this.wakeAll();
    }
  }

  public beginDrag(id: string): void {
    const entry = this.tracked.get(id);
    if (!entry) return;
    this.draggingId = id;
    entry.body.type = CANNON.Body.KINEMATIC;
    entry.body.mass = 0;
    entry.body.updateMassProperties();
    entry.body.velocity.setZero();
    entry.body.angularVelocity.setZero();
    entry.body.wakeUp();
    // Wake stacked objects resting on this object so they fall naturally!
    this.wakeAll();
  }

  public setDragTarget(id: string, x: number, y: number, z: number, rotY: number): void {
    const entry = this.tracked.get(id);
    if (!entry) return;
    entry.body.position.set(x, Math.max(0, y), z);
    entry.body.quaternion.setFromEuler(0, rotY, 0);
    entry.body.velocity.setZero();
    entry.body.angularVelocity.setZero();
  }

  public endDrag(id: string): void {
    const entry = this.tracked.get(id);
    if (this.draggingId === id) {
      this.draggingId = null;
    }
    if (!entry) return;
    const isKinematicMotion = Boolean(entry.data.motion && entry.data.motion !== 'static');
    if (!isKinematicMotion) {
      const [w, h, d] = entry.size;
      entry.body.type = CANNON.Body.DYNAMIC;
      entry.body.mass = Math.max(8, Math.min(85, w * h * d * 10));
      entry.body.updateMassProperties();
      entry.body.velocity.set(0, -0.25, 0);
      entry.wasAwake = true;
      entry.dirtySettled = true;
    }
    this.wakeAll();
  }

  /**
   * Lifts an object vertically and lets Cannon.js gravity drop it onto whatever is below.
   */
  public dropFromHeight(id: string, deltaY = 3.0): [number, number, number] | null {
    const entry = this.tracked.get(id);
    if (!entry) return null;
    const nx = entry.body.position.x;
    const ny = Math.min(20, Math.max(0, entry.body.position.y) + deltaY);
    const nz = entry.body.position.z;
    entry.body.position.set(nx, ny, nz);
    entry.body.velocity.set(0, 0, 0);
    entry.body.angularVelocity.set(0, 0, 0);
    entry.body.wakeUp();
    entry.wasAwake = true;
    entry.dirtySettled = true;
    return [Number(nx.toFixed(2)), Number(ny.toFixed(2)), Number(nz.toFixed(2))];
  }

  /**
   * Nudges a dynamic rigid body with a physics impulse (demonstrates collision & momentum).
   */
  public applyImpulse(id: string, vx: number, vy: number, vz: number): void {
    const entry = this.tracked.get(id);
    if (!entry || entry.body.type !== CANNON.Body.DYNAMIC) return;
    entry.body.wakeUp();
    entry.body.velocity.set(vx, vy, vz);
    entry.wasAwake = true;
    entry.dirtySettled = true;
  }

  public getBodyTopY(x: number, z: number, excludeId: string | null): number {
    let topY = 0;
    for (const [id, entry] of this.tracked.entries()) {
      if (excludeId && id === excludeId) continue;
      const [w, h, d] = entry.size;
      const dx = Math.abs(x - entry.body.position.x);
      const dz = Math.abs(z - entry.body.position.z);
      if (dx <= w * 0.58 && dz <= d * 0.58) {
        topY = Math.max(topY, Math.max(0, entry.body.position.y) + h);
      }
    }
    return Number(topY.toFixed(3));
  }

  public step(deltaSeconds: number): {
    poses: PhysicsBodyPose[];
    newlySettled: Array<{ id: string; position: [number, number, number]; rotationY: number }>;
    stats: PhysicsEngineStats;
  } {
    const dt = Math.min(Math.max(deltaSeconds, 1 / 240), 0.18);
    this.totalElapsed += dt;
    this.collisionEventsThisStep = 0;

    // Drive kinematic animated objects inside Cannon.js so dynamic props collide with them
    for (const [id, entry] of this.tracked.entries()) {
      if (this.draggingId === id) continue;
      if (entry.body.type === CANNON.Body.KINEMATIC) {
        const t = computeObjectMotionTransform(
          entry.data.motion,
          entry.data.position,
          entry.data.rotationY,
          this.totalElapsed,
          entry.phaseOffset,
        );
        entry.body.position.set(t.x, Math.max(0, t.y), t.z);
        entry.body.quaternion.setFromEuler(0, t.rotationY, 0);
      }
    }

    this.world.step(1 / 60, dt, 10);

    const poses: PhysicsBodyPose[] = [];
    const newlySettled: Array<{ id: string; position: [number, number, number]; rotationY: number }> = [];
    let dynamicCount = 0;
    let sleepingCount = 0;

    for (const [id, entry] of this.tracked.entries()) {
      const b = entry.body;
      // Arena containment bounds
      if (b.position.y < 0) {
        b.position.y = 0;
        if (b.velocity.y < 0) b.velocity.y = 0;
      }
      if (Math.abs(b.position.x) > 38) {
        b.position.x = Math.sign(b.position.x) * 38;
        b.velocity.x *= -0.4;
      }
      if (Math.abs(b.position.z) > 38) {
        b.position.z = Math.sign(b.position.z) * 38;
        b.velocity.z *= -0.4;
      }

      const isDyn = b.type === CANNON.Body.DYNAMIC;
      const isSleeping = b.sleepState === CANNON.Body.SLEEPING;
      if (isDyn) dynamicCount++;
      if (isSleeping) sleepingCount++;

      // Notify caller once when a dropped/moved dynamic body comes to rest
      if (isDyn && entry.dirtySettled && isSleeping && this.draggingId !== id) {
        entry.dirtySettled = false;
        const euler = new CANNON.Vec3();
        b.quaternion.toEuler(euler);
        newlySettled.push({
          id,
          position: [
            Number(b.position.x.toFixed(2)),
            Number(Math.max(0, b.position.y).toFixed(2)),
            Number(b.position.z.toFixed(2)),
          ],
          rotationY: Number(euler.y.toFixed(3)),
        });
      }

      poses.push({
        id,
        position: [b.position.x, b.position.y, b.position.z],
        quaternion: [b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w],
        sleeping: isSleeping,
        isDynamic: isDyn,
      });
    }

    return {
      poses,
      newlySettled,
      stats: {
        dynamicCount,
        sleepingCount,
        collisionCount: this.collisionEventsThisStep,
        gravityY: this.world.gravity.y,
      },
    };
  }
}
