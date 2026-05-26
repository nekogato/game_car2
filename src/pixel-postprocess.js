import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { PIXEL_SHADER_PARAMS } from '../pixel-shader.js';

const PixelSceneShader = {
  uniforms: {
    tDiffuse: { value: null },
    resolution: { value: new THREE.Vector2(1, 1) },
    pixelSize: { value: PIXEL_SHADER_PARAMS.pixelSize },
    colorLevels: { value: PIXEL_SHADER_PARAMS.colorLevels },
    ditherStrength: { value: PIXEL_SHADER_PARAMS.ditherStrength },
    scanlineStrength: { value: PIXEL_SHADER_PARAMS.scanlineStrength },
    scanlineCount: { value: PIXEL_SHADER_PARAMS.scanlineCount },
    vignetteStrength: { value: PIXEL_SHADER_PARAMS.vignetteStrength },
    enabled: { value: PIXEL_SHADER_PARAMS.enabled ? 1 : 0 },
  },
  vertexShader: `
    varying vec2 vUv;

    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float pixelSize;
    uniform float colorLevels;
    uniform float ditherStrength;
    uniform float scanlineStrength;
    uniform float scanlineCount;
    uniform float vignetteStrength;
    uniform int enabled;
    varying vec2 vUv;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    void main() {
      if (enabled == 0) {
        gl_FragColor = texture2D(tDiffuse, vUv);
        return;
      }

      vec2 safeResolution = max(resolution, vec2(1.0));
      vec2 block = vec2(max(pixelSize, 1.0)) / safeResolution;
      vec2 uv = (floor(vUv / block) + 0.5) * block;
      vec4 color = texture2D(tDiffuse, clamp(uv, vec2(0.0), vec2(1.0)));

      float dither = (hash(floor(vUv * safeResolution / max(pixelSize, 1.0))) - 0.5) * ditherStrength;
      color.rgb += dither;

      float levels = max(colorLevels, 2.0);
      color.rgb = floor(clamp(color.rgb, 0.0, 1.0) * levels) / levels;

      float scan = sin(vUv.y * scanlineCount * 6.28318530718) * 0.5 + 0.5;
      color.rgb *= 1.0 - scanlineStrength * scan;

      float vignette = smoothstep(0.82, 0.18, distance(vUv, vec2(0.5)));
      color.rgb *= mix(1.0 - vignetteStrength, 1.0, vignette);

      gl_FragColor = vec4(color.rgb, color.a);
    }
  `,
};

export function createPixelPipeline(renderer, scene, camera, canvas) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const pixelPass = new ShaderPass(PixelSceneShader);
  composer.addPass(pixelPass);
  window.PIXEL_SHADER_PARAMS = PIXEL_SHADER_PARAMS;

  function updatePixelShader() {
    const uniforms = pixelPass.uniforms;
    uniforms.resolution.value.set(canvas.width, canvas.height);
    uniforms.pixelSize.value = PIXEL_SHADER_PARAMS.pixelSize;
    uniforms.colorLevels.value = PIXEL_SHADER_PARAMS.colorLevels;
    uniforms.ditherStrength.value = PIXEL_SHADER_PARAMS.ditherStrength;
    uniforms.scanlineStrength.value = PIXEL_SHADER_PARAMS.scanlineStrength;
    uniforms.scanlineCount.value = PIXEL_SHADER_PARAMS.scanlineCount;
    uniforms.vignetteStrength.value = PIXEL_SHADER_PARAMS.vignetteStrength;
    uniforms.enabled.value = PIXEL_SHADER_PARAMS.enabled ? 1 : 0;
  }

  return { composer, updatePixelShader };
}
