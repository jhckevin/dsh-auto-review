// @vitest-environment jsdom
import {act,createElement,type ComponentProps} from 'react'
import {createRoot} from 'react-dom/client'
import {describe,it,expect,vi} from 'vitest'
import {AutoReviewSettingsSection} from '../src/client/index.tsx'
import {DEFAULT_AUTO_REVIEW_UI_SETTINGS} from '../src/settings.ts'
type Props=ComponentProps<typeof AutoReviewSettingsSection>
async function mount(writable=true, update=vi.fn(), initial: Partial<typeof DEFAULT_AUTO_REVIEW_UI_SETTINGS>={}) {
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
 const el=document.createElement('div');document.body.append(el);const root=createRoot(el)
 const value={...DEFAULT_AUTO_REVIEW_UI_SETTINGS,...initial}
 const read=vi.fn().mockResolvedValue({value,revision:7,user:{},writable})
 const props={read,update,reset:vi.fn(),metrics:vi.fn().mockResolvedValue(undefined),t:(key:string)=>key} as unknown as Props
 await act(async()=>{root.render(createElement(AutoReviewSettingsSection,props))})
 return {el,root,update,close:async()=>{await act(async()=>root.unmount());el.remove();vi.unstubAllGlobals()}}
}
describe('settings interaction state',()=>{
 it('explains invalid settings instead of only disabling save',async()=>{
  const x=await mount(true,vi.fn(),{maxAttempts:0});try{
   expect(x.el.querySelector('[role="alert"]')?.textContent).toBe('invalidSettings')
   expect(x.el.querySelector<HTMLButtonElement>('.ar-primary')?.disabled).toBe(true)
  }finally{await x.close()}
 })
 it('does not offer saving an unchanged form and shows persisted state',async()=>{
  const x=await mount();try{
   expect(x.el.querySelector<HTMLButtonElement>('.ar-primary')?.disabled).toBe(true)
   expect(x.el.querySelector('.ar-live')?.textContent).toBe('active')
   await act(async()=>x.el.querySelector<HTMLButtonElement>('[aria-label="enabled"]')!.click())
   expect(x.el.querySelector('.ar-live')?.textContent).toBe('pending')
   expect(x.el.querySelector<HTMLButtonElement>('.ar-primary')?.disabled).toBe(false)
  }finally{await x.close()}
 })
 it('submits only changed fields and locks editing until the save completes',async()=>{
  let resolve!:(v:unknown)=>void
  const update=vi.fn(()=>new Promise(r=>{resolve=r}));const x=await mount(true,update)
  try{
   await act(async()=>x.el.querySelector<HTMLButtonElement>('[aria-label="enabled"]')!.click())
   await act(async()=>x.el.querySelector<HTMLButtonElement>('.ar-primary')!.click())
   expect(update).toHaveBeenCalledWith({enabled:false},7)
   expect(x.el.querySelector<HTMLFieldSetElement>('.ar-controls')?.disabled).toBe(true)
   expect(x.el.querySelector('.ar-live')?.textContent).toBe('saving')
   await act(async()=>resolve({value:{...DEFAULT_AUTO_REVIEW_UI_SETTINGS,enabled:false},user:{enabled:false},writable:true,revision:8}))
   expect(x.el.querySelector('.ar-live')?.textContent).toBe('inactive')
  }finally{await x.close()}
 })
 it('keeps unsaved changes after a failed save',async()=>{
  const x=await mount(true,vi.fn().mockRejectedValue(Error('revision conflict')))
  try{
   await act(async()=>x.el.querySelector<HTMLButtonElement>('[aria-label="enabled"]')!.click())
   await act(async()=>x.el.querySelector<HTMLButtonElement>('.ar-primary')!.click())
   expect(x.el.querySelector('.ar-live')?.textContent).toBe('pending')
   expect(x.el.querySelector('.ar-failed')?.textContent).toBe('failed')
   expect(x.el.querySelector<HTMLFieldSetElement>('.ar-controls')?.disabled).toBe(false)
  }finally{await x.close()}
 })
 it('locks all settings for a read-only connection',async()=>{
  const x=await mount(false);try{
   expect(x.el.querySelector<HTMLFieldSetElement>('.ar-controls')?.disabled).toBe(true)
   expect(x.el.textContent).toContain('readOnly')
  }finally{await x.close()}
 })
 it('updates Full Access behavior text with the selected switch',async()=>{
  const x=await mount();try{
   expect(x.el.querySelector('.ar-behavior')?.textContent).toContain('fullAccessReview')
   await act(async()=>x.el.querySelector<HTMLButtonElement>('[aria-label="reviewFullAccess"]')!.click())
   expect(x.el.querySelector('.ar-behavior')?.textContent).toContain('fullAccessNative')
  }finally{await x.close()}
 })
})
