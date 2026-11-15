import { wordmarkSvg } from './brand/logo'
import { qrSvg } from './QrCode'
export function inviteUrl(origin:string, room:string):string {
  const url=new URL('/',origin);url.searchParams.set('room',room);return url.href
}
export class InviteView {
  readonly element=document.createElement('section')
  private url=''
  constructor(parent:HTMLElement, close:()=>void, copy:()=>void) {
    this.element.className='join-view';this.element.hidden=true;this.element.setAttribute('role','dialog');this.element.setAttribute('aria-modal','true');this.element.setAttribute('aria-label','Join this room')
    this.element.innerHTML=wordmarkSvg()+'<h1>Join this room</h1><p class="join-room"></p><div class="invite-qr"></div><p class="invite-link"></p><p class="join-count"></p><div><button class="join-copy">Copy invite</button><button class="join-close">Back · J</button></div>'
    this.element.querySelector('.join-close')!.addEventListener('click',close);this.element.querySelector('.join-copy')!.addEventListener('click',copy);parent.append(this.element)
  }
  update(url:string,room:string,count:number):void {
    if(url!==this.url){this.url=url;renderQr(this.element.querySelector('.invite-qr')!,url);this.element.querySelector('.invite-link')!.textContent=url}
    this.element.querySelector('.join-room')!.textContent=room
    this.element.querySelector('.join-count')!.textContent=`${count} ${count===1?'player':'players'} in this room`
  }
  show():void {this.element.hidden=false;this.element.querySelector<HTMLButtonElement>('.join-close')!.focus()}
  hide():void {this.element.hidden=true}
  dispose():void {this.element.remove()}
}
export function renderQr(host:Element,url:string):void {try{host.replaceChildren(qrSvg(url))}catch(error){host.textContent=error instanceof Error?error.message:'Copy the invite link to join.'}}
