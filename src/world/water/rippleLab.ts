import * as T from 'three/webgpu'
import { cameraViewMatrix, positionWorld, positionGeometry, positionLocal, vec3 } from 'three/tsl'
import { Ripples, waterRipples } from './ripples'
import { Spray, waterSpray } from './spray'
const renderer=new T.WebGPURenderer({antialias:true,forceWebGL:new URLSearchParams(location.search).has('webgl')})
renderer.setSize(innerWidth,innerHeight);document.body.append(renderer.domElement);await renderer.init()
const scene=new T.Scene(), camera=new T.PerspectiveCamera(50,innerWidth/innerHeight,.1,500)
camera.position.set(45,50,55);camera.lookAt(0,0,0)
scene.add(new T.HemisphereLight(0xcceeff,0x123344,3))
const sun=new T.DirectionalLight(0xffffff,4);sun.position.set(20,50,10);scene.add(sun)
waterRipples.value=true;waterSpray.value=true
const ripples=new Ripples(renderer),spray=new Spray(scene,ripples)
const material=new T.MeshStandardNodeMaterial({color:0x168fba,roughness:.22,metalness:.15})
material.positionNode=positionLocal.add(vec3(0,ripples.rippleHeight(positionGeometry.xz),0))
material.normalNode=cameraViewMatrix.transformDirection(ripples.rippleNormal(positionWorld.xz))
const plane=new T.Mesh(new T.PlaneGeometry(128,128,256,256).rotateX(-Math.PI/2),material);scene.add(plane)
const object=new T.Mesh(new T.BoxGeometry(2,1,4),new T.MeshStandardMaterial({color:0xeeb633}));scene.add(object)
let previous=performance.now(),t=0
renderer.setAnimationLoop(()=>{const now=performance.now(),dt=Math.min(.05,(now-previous)/1000);previous=now;t+=dt
 object.position.set(18*Math.cos(t*.4),.35,18*Math.sin(t*.4));object.rotation.y=-t*.4
 spray.update(dt);spray.vehicle('lab',object.position,new T.Vector3(-7.2*Math.sin(t*.4),0,7.2*Math.cos(t*.4)),.5,dt)
 ripples.update(dt,0,0);renderer.render(scene,camera)
})
addEventListener('resize',()=>{renderer.setSize(innerWidth,innerHeight);camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix()})
