#version 300 es
// Adapted from our Apache-2.0-derived Regular material. See NOTICE.md.
precision highp float;
uniform sampler2D scene, frost;
uniform vec2 pixels, points;
uniform vec4 box, faceTransfer;
uniform vec2 panelTransfer;
uniform vec3 edgeStrength;
uniform float radius, dark, panel, opacity, pressed, veil;
out vec4 color;
void main() {
  if (veil > 0.0) {
    color = vec4(vec3(2.0,8.0,14.0)*veil/255.0,veil);
    return;
  }
  vec2 uv = gl_FragCoord.xy / pixels;
  vec2 local = vec2(uv.x, 1.0 - uv.y) * points - box.xy;
  vec2 q = abs(local) - box.zw + radius;
  vec2 outer = max(q, 0.0);
  float dist = length(outer) + min(max(q.x, q.y), 0.0) - radius;
  float coverage = clamp(.5 - dist * pixels.x / points.x, 0.0, 1.0);
  vec3 original = texture(scene, uv).rgb;
  vec2 n = (length(outer) > .001 ? normalize(outer) : (q.x > q.y ? vec2(1,0) : vec2(0,1))) * sign(local);
  float l = dot(original, vec3(.2126,.7152,.0722));
  float edge = clamp((.5 - max(dist, 0.0)) * pixels.x / points.x + .5, 0.0, 1.0);
  float hair = .90 - .59*l + dark * pow(max(l-.5, 0.0),2.0) * 1.22 / max(l,.001);
  float halo = .014 * max((n.y+.2)/1.2,0.0) * clamp(1.0-max(dist,0.0)/14.0,0.0,1.0);
  float transmission = (1.0-halo) * (1.0-min(1.0,edge*hair*(1.0-n.y*n.y*mix(.69,1.0,dark))*edgeStrength.y));
  vec3 surface = vec3(0);
  if (coverage > 0.0) {
    float r = max(1.0, mix(min(box.z, box.w), radius, panel));
    float depth = max(-dist,0.0), small = clamp((30.0-r)/6.0,0.0,1.0);
    float shift = r * mix(.743,.832+abs(n.y)*.044,small)
      * pow(clamp(1.0-depth/(r*mix(.767,1.4,small)),0.0,1.0),mix(4.28,8.75-abs(n.y)*.34,small));
    vec3 detail = texture(scene, uv - vec2(n.x,-n.y)*shift/points).rgb;
    vec3 wide = texture(frost,uv).rgb, delta = detail-wide;
    vec3 body = wide + delta*.275 + abs(delta)*mix(.22,-.22,dark);
    float y = dot(body,vec3(.2126,.7152,.0722));
    float tone = faceTransfer.x*y*y+faceTransfer.y*y+faceTransfer.z;
    tone = mix(tone,panelTransfer.x*y+panelTransfer.y,panel);
    vec3 gain = mix(vec3(.988,.952,.979)+y*vec3(-.076,.028,-.045),
      vec3(1.317,1.256,1.314)+y*vec3(-.427,-.351,-.429),dark);
    float narrow = max(1.0-depth/1.17,0.0), pole = n.y*n.y;
    float rim = narrow*pole*mix(.1225-.0184*tone,.1478-.069*tone,dark)
      + narrow*pow(pole,4.0)*mix(.0442-.087*tone,.019+.0065*tone,dark)
      + exp(-.5*depth)*pole*pole*mix(.101-.0911*tone,.0909-.0779*tone,dark)
      + exp(-.2*depth)*(1.0-pole)*mix(.0007-.028*tone,.0031-.0344*tone,dark)
      + max(1.0-depth/.48,0.0)*mix(-.1476+.0954*tone,-.0743+.0941*tone,dark);
    vec3 face = clamp(vec3(tone+rim*edgeStrength.x)+(body-y)*gain*faceTransfer.w,0.0,1.0);
    face = mix(face, vec3(1), pressed*edgeStrength.z);
    // Match the gameplay white-ink transfer, leaving the outer rim intact.
    vec3 linear = mix(pow((face+.055)/1.055,vec3(2.4)),face/12.92,lessThanEqual(face,vec3(.04045)));
    float luminance = dot(linear, vec3(.2126,.7152,.0722)), limit = mix(.18,.16,panel);
    if (luminance > limit) {
      linear *= limit/luminance;
      vec3 safe = mix(1.055*pow(linear,vec3(1./2.4))-.055,12.92*linear,lessThanEqual(linear,vec3(.0031308)));
      face = mix(face,safe,clamp(depth-1.,0.,1.));
    }
    surface = face*coverage;
  }
  color = opacity * vec4(surface,1.0-(1.0-coverage)*transmission);
}
