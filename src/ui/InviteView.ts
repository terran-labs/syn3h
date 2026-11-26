import { wordmarkSvg } from './brand/logo'
import { qrSvg } from './QrCode'
import { isDefaultRoom } from '../core/roomAddress'
import { inviteAddress } from './LobbyAddress'
/** A link into a room (none named for the public room). With `world`, an empty room rebuilds that world. */
export function inviteUrl(origin:string, room:string, world?:string):string { return inviteAddress(new URL('/',origin),room,world) }
export class InviteView {
  readonly element=document.createElement('section')
  private url=''
  private room:string|undefined
  private count=-1
  constructor(parent:HTMLElement, close:()=>void, copy:()=>void) {
    this.element.className='join-view';this.element.hidden=true;this.element.setAttribute('role','dialog');this.element.setAttribute('aria-modal','true');this.element.setAttribute('aria-label','Join this room')
    this.element.innerHTML=wordmarkSvg()+'<h1>Join this room</h1><p class="join-room"></p><div class="invite-qr"></div><p class="invite-link"></p><p class="join-count"></p><div class="join-actions"><button class="panel-action join-copy" type="button">Copy invite</button><button class="panel-action join-close panel-back" type="button"><span aria-hidden="true">←</span><span>Back<span class="join-key"> · J</span></span></button></div>'
    this.element.querySelector('.join-close')!.addEventListener('click',close);this.element.querySelector('.join-copy')!.addEventListener('click',copy);parent.append(this.element)
  }
  update(url:string,room:string,count:number):void {
    if(url!==this.url){this.url=url;renderQr(this.element.querySelector('.invite-qr')!,url);this.element.querySelector('.invite-link')!.textContent=url}
    // Called often; write the DOM only when the text changes.
    // The public room is described in words; its internal name is never shown.
    if(room!==this.room){
      this.room=room;this.count=-1;const open=isDefaultRoom(room),title=open?'Join this world':'Join this room'
      this.element.querySelector('h1')!.textContent=title;this.element.setAttribute('aria-label',title)
      this.element.querySelector('.join-room')!.textContent=open?'Public room':room
    }
    if(count!==this.count){this.count=count;this.element.querySelector('.join-count')!.textContent=`${count} ${count===1?'player':'players'} ${isDefaultRoom(room)?'here':'in this room'}`}
  }
  show():void {this.element.hidden=false;this.element.querySelector<HTMLButtonElement>('.join-close')!.focus()}
  hide():void {this.element.hidden=true}
  dispose():void {this.element.remove()}
}
export function renderQr(host:Element,url:string):void {try{host.replaceChildren(qrSvg(url))}catch(error){host.textContent=error instanceof Error?error.message:'Copy the invite link to join.'}}
