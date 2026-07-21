/**
 * collision.ts
 *
 * Utility functions for collision detection and resolution
 * used by the cloth simulation.
 *
 * Currently implements:
 *   - Sphere collision (cloth draping over sphere)
 *
 * The approach is simple and fast:
 *   1. Test if particle is inside the sphere (dist < radius)
 *   2. If so, push it to the nearest surface point
 *
 * Future extensions could include:
 *   - AABB (box) collision
 *   - Plane/floor collision
 *   - Cloth self-collision (expensive — use spatial hashing)
 */

import * as THREE from "three";

/**
 * Resolve a point-sphere collision.
 * Returns the corrected position if the point is inside the sphere,
 * or the original position if no collision.
 *
 * @param point - particle position to test
 * @param sphereCenter - center of the collision sphere
 * @param sphereRadius - radius of the collision sphere (including offset for cloth thickness)
 * @returns corrected position
 */
export function resolveSphereCollision(
  point: THREE.Vector3,
  sphereCenter: THREE.Vector3,
  sphereRadius: number
): THREE.Vector3 {
  const diff = point.clone().sub(sphereCenter);
  const dist = diff.length();

  if (dist < sphereRadius) {
    // Push to sphere surface along the radial direction
    return sphereCenter.clone().addScaledVector(diff, sphereRadius / dist);
  }

  return point.clone();
}

/**
 * Test if a line segment (spring) passes through a sphere.
 * Used for more accurate spring-sphere intersection (optional refinement).
 *
 * @param a - spring endpoint A
 * @param b - spring endpoint B
 * @param center - sphere center
 * @param radius - sphere radius
 * @returns true if the segment intersects the sphere
 */
export function springIntersectsSphere(
  a: THREE.Vector3,
  b: THREE.Vector3,
  center: THREE.Vector3,
  radius: number
): boolean {
  const ab = b.clone().sub(a);
  const ac = center.clone().sub(a);
  const t = Math.max(0, Math.min(1, ac.dot(ab) / ab.lengthSq()));
  const closestPoint = a.clone().addScaledVector(ab, t);
  return closestPoint.distanceTo(center) < radius;
}
