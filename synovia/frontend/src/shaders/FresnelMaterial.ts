import { shaderMaterial } from '@react-three/drei';
import { extend } from '@react-three/fiber';
import * as THREE from 'three';

// Soft SSS-approximation Fresnel shader
// Looks like frosted silicone / translucent gummy material
const vertexShader = /* glsl */ `
  varying vec3 vWorldNormal;
  varying vec3 vViewPosition;
  varying vec3 vWorldPosition;

  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;

    vec4 wn = modelMatrix * vec4(normal, 0.0);
    vWorldNormal = normalize(wn.xyz);

    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = -mvPos.xyz;

    gl_Position = projectionMatrix * mvPos;
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3  uBaseColor;       // deep interior tint
  uniform vec3  uRimColor;        // edge glow (soft, not neon)
  uniform vec3  uSSSColor;        // subsurface scatter color (warm)
  uniform float uFresnelPower;    // rim sharpness — higher = thinner rim
  uniform float uFresnelScale;    // rim intensity
  uniform float uOpacity;         // base alpha
  uniform float uSSSStrength;     // subsurface contribution (0–1)

  varying vec3 vWorldNormal;
  varying vec3 vViewPosition;

  void main() {
    vec3 viewDir = normalize(vViewPosition);
    vec3 normal  = normalize(vWorldNormal);

    // Core Fresnel — grazing angle glow
    float NdotV  = abs(dot(viewDir, normal));
    float fresnel = clamp(uFresnelScale * pow(1.0 - NdotV, uFresnelPower), 0.0, 1.0);

    // SSS approximation: back-scatter brightens the interior
    float sss = clamp(1.0 - NdotV, 0.0, 1.0) * uSSSStrength;

    // Blend: interior (base + SSS) → rim color
    vec3 interior = mix(uBaseColor, uSSSColor, sss * 0.6);
    vec3 color    = mix(interior, uRimColor, fresnel * 0.8);

    // Soft alpha — edges more visible (glass edge effect)
    float alpha = uOpacity + fresnel * (1.0 - uOpacity) * 0.75 + sss * 0.08;
    alpha = clamp(alpha, 0.0, 1.0);

    gl_FragColor = vec4(color, alpha);
  }
`;

export const FresnelMaterial = shaderMaterial(
  {
    uBaseColor:    new THREE.Color(0x0d1a2e),  // deep navy interior
    uRimColor:     new THREE.Color(0x5eead4),  // soft teal rim
    uSSSColor:     new THREE.Color(0x7dd3fc),  // sky-blue SSS
    uFresnelPower: 3.0,
    uFresnelScale: 1.0,
    uOpacity:      0.14,
    uSSSStrength:  0.5,
  },
  vertexShader,
  fragmentShader
);

extend({ FresnelMaterial });

declare module '@react-three/fiber' {
  interface ThreeElements {
    fresnelMaterial: React.PropsWithChildren<{
      uBaseColor?: THREE.Color | string | number;
      uRimColor?: THREE.Color | string | number;
      uSSSColor?: THREE.Color | string | number;
      uFresnelPower?: number;
      uFresnelScale?: number;
      uOpacity?: number;
      uSSSStrength?: number;
      ref?: React.Ref<any>;
      transparent?: boolean;
      depthWrite?: boolean;
      side?: THREE.Side;
    }>;
  }
}
