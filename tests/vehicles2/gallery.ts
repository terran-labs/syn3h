import * as THREE from 'three/webgpu'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { Jet } from '../../src/vehicles/Jet'
import { Hovercraft } from '../../src/vehicles/Hovercraft'
import { initPhysics } from '../../src/core/physics'
import { harness } from './harness'

async function main(){
 await initPhysics()
 const renderer=new THREE.WebGPURenderer({antialias:true});await renderer.init()
 renderer.setSize(innerWidth,innerHeight);renderer.setPixelRatio(Math.min(devicePixelRatio,2));renderer.shadowMap.enabled=true
 renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.25;document.body.append(renderer.domElement)
 const h=harness(0,false), scene=h.game.scene
 scene.background=new THREE.Color(0x202631)
 scene.fog=new THREE.Fog(0x202631,25,90)
 scene.environmentIntensity=.65
 const room=new RoomEnvironment(),pmrem=new THREE.PMREMGenerator(renderer)
 const env=pmrem.fromScene(room,.04);scene.environment=env.texture;room.dispose();pmrem.dispose()
 scene.add(new THREE.HemisphereLight(0xd8e8ff,0x82715a,2))
 const sun=new THREE.DirectionalLight(0xffe4cb,3);sun.position.set(2,10,-6);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);sun.shadow.normalBias=.025
 Object.assign(sun.shadow.camera,{left:-12,right:12,top:12,bottom:-12});scene.add(sun)
 const fill=new THREE.DirectionalLight(0x8ccaff,2);fill.position.set(-6,4,3);scene.add(fill)
 const ground=new THREE.Mesh(new THREE.PlaneGeometry(200,200),new THREE.MeshStandardMaterial({color:0x38414b,roughness:.65}));ground.rotation.x=-Math.PI/2;ground.receiveShadow=true;scene.add(ground)
 const hover=new URLSearchParams(location.search).get('vehicle')==='hovercraft'
 document.querySelector('#title')!.textContent=hover?'Syn3h Hovercraft':'Syn3h Jet'
 const vehicle=hover?new Hovercraft(h.game,h.terrain,new THREE.Vector3(0,1.65,0)):new Jet(h.game,h.terrain,new THREE.Vector3(0,1.65,0));vehicle.isLocal=false;vehicle.input.z=.7
 await vehicle.modelReady
 const camera=new THREE.PerspectiveCamera(38,innerWidth/innerHeight,.1,200)
 camera.position.set(hover?4:9,hover?3.2:4,hover?-5:-11)
 const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,1.6,0);controls.update()
 const api={vehicle,renderer,ready:true,flight(){vehicle.input.special=true},hover(){vehicle.input.special=false},rear(){camera.position.set(hover?-4:-8,hover?3.2:5,hover?5:10);controls.update()},front(){camera.position.set(hover?4:9,hover?3.2:4,hover?-5:-11);controls.update()}}
 Object.assign(window,{vehicleGallery:api});document.querySelector('#status')!.textContent='Drag to orbit · Scroll to zoom'
 let previous=performance.now()
 renderer.setAnimationLoop(()=>{const now=performance.now(),dt=Math.min(.1,(now-previous)/1000);previous=now;for(let t=0;t<dt;t+=.02)vehicle.fixedUpdate(Math.min(.02,dt-t));vehicle.update(dt,1);controls.update();renderer.render(scene,camera)})
 addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight)})
 addEventListener('pagehide',()=>{renderer.setAnimationLoop(null);vehicle.dispose();h.world.free();env.dispose();renderer.dispose()},{once:true})
}
main().catch(e=>{document.querySelector('#status')!.textContent=String(e);console.error(e)})
