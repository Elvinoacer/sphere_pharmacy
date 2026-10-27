import { db } from "@/lib/db"
import { DELIVERY_DEFAULTS, PHARMACY } from "@/lib/constants"
import type { ComplianceInfo, DeliverySettings, PharmacySettings } from "@/lib/types"

const DEFAULT_COMPLIANCE: ComplianceInfo = {
  premiseLicenceNumber: "",
  premiseLicenceExpiry: "",
  superintendentName: "",
  superintendentReg: "",
  notes: "",
}

export function distanceKm(lat1:number,lon1:number,lat2:number,lon2:number) {
  const R=6371
  const dLat=(lat2-lat1)*Math.PI/180
  const dLon=(lon2-lon1)*Math.PI/180
  const a=Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLon/2)**2
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))
}

export function computeDeliveryFee(area:string|null|undefined, settings:DeliverySettings, subtotal:number, latitude?:number|null, longitude?:number|null) {
  if(settings.freeOver && subtotal>=settings.freeOver)return 0
  if(settings.mode==="flat")return settings.flatFee
  if(settings.pricingMode==="distance" && latitude!=null && longitude!=null && settings.pharmacyLocation?.latitude!=null && settings.pharmacyLocation?.longitude!=null){
    const km=distanceKm(settings.pharmacyLocation.latitude,settings.pharmacyLocation.longitude,latitude,longitude)
    const band=(settings.distanceBands??[]).find(b=>km>=b.minKm && (b.maxKm==null||km<b.maxKm))
    if(band)return band.fee
  }
  if(!area)return settings.flatFee
  const zone=(settings.zones??[]).find(z=>z.name.toLowerCase()===area.toLowerCase().trim())
  return zone?.fee ?? (settings.zones?.[settings.zones.length-1]?.fee ?? settings.flatFee)
}

export async function getSettings(){
 const rows=await db.setting.findMany({where:{key:{in:["pharmacy","delivery","compliance"]}}})
 const map:Record<string,unknown>={}
 for(const row of rows){try{map[row.key]=JSON.parse(row.value)}catch{}}
 return {
  pharmacy:{...PHARMACY,...((map.pharmacy as Partial<PharmacySettings>)??{})} as PharmacySettings,
  delivery:{...DELIVERY_DEFAULTS,...((map.delivery as Partial<DeliverySettings>)??{})} as DeliverySettings,
  compliance:{...DEFAULT_COMPLIANCE,...((map.compliance as Partial<ComplianceInfo>)??{})} as ComplianceInfo,
 }
}
export async function saveSettingsSection(key:string,value:Record<string,unknown>){
 const existing=await db.setting.findUnique({where:{key}})
 if(existing){let current:Record<string,unknown>={};try{current=JSON.parse(existing.value)}catch{};await db.setting.update({where:{key},data:{value:JSON.stringify({...current,...value})}})}
 else await db.setting.create({data:{key,value:JSON.stringify(value)}})
}
