/// <reference types="bun-types" />
import { describe, expect, test, mock, beforeEach, afterAll } from "bun:test"
import { fallbackIntent, hasCredential, intentSchema, redact, safetyResponse, safeModelReply } from "../src/lib/assistant/contracts"
import { orderCanBePaid, bookingCanBePaid, reviewAmount } from "../src/lib/assistant/payment-review"

describe("assistant action boundaries",()=>{
  test("exact medicine names and strengths remain searchable",()=>{
    expect(safetyResponse("Find paracetamol 500mg")).toBeNull()
    expect(fallbackIntent("Find paracetamol 500mg")).toEqual({type:"search",query:"paracetamol 500mg"})
    expect(safetyResponse("What dose of paracetamol can I give my child?")).not.toBeNull()
  })
  test("urgent distress goes to immediate help rather than shopping",()=>{
    expect(safetyResponse("I can't breathe, find an inhaler")).toContain("emergency")
    expect(safetyResponse("I took an overdose")).toContain("don’t wait")
  })
  test("no arbitrary URLs, staff tools or payment amounts can be supplied as intents",()=>{
    expect(intentSchema.safeParse({type:"navigate",view:"admin"}).success).toBe(false)
    expect(intentSchema.safeParse({type:"execute",url:"https://evil.example",amount:1}).success).toBe(false)
    expect(intentSchema.parse({type:"pay",amount:1,orderId:"someone-else"})).toEqual({type:"pay"})
  })
  test("actions do not require an AI provider",()=>{
    expect(fallbackIntent("Book a medication review")).toEqual({type:"book",query:"medication review"})
    expect(fallbackIntent("Take me to checkout")).toEqual({type:"navigate",view:"checkout"})
    expect(fallbackIntent("Help me pay with M-Pesa")).toEqual({type:"pay"})
    expect(fallbackIntent("View my appointments")).toEqual({type:"appointments"})
  })
  test("credentials are caught before redaction and false success claims are replaced",()=>{
    expect(hasCredential("My PIN: 1234")).toBe(true)
    expect(redact("password=secret-value phone 0712345678 me@example.com")).not.toContain("secret-value")
    expect(redact("password=secret-value phone 0712345678 me@example.com")).not.toContain("0712345678")
    expect(safeModelReply("I've paid for your order")).toContain("review and confirm")
  })
})
describe("private payment review",()=>{
  test("review-stage, completed and already-processing orders cannot be selected for payment",()=>{
    expect(orderCanBePaid({status:"UNDER_REVIEW",total:500,payments:[]})).toBe(false)
    expect(orderCanBePaid({status:"AWAITING_PAYMENT",total:500,payments:[{status:"PROCESSING"}]})).toBe(false)
    expect(orderCanBePaid({status:"AWAITING_PAYMENT",total:500,payments:[{status:"SUCCESS"}]})).toBe(false)
    expect(orderCanBePaid({status:"AWAITING_PAYMENT",total:500,payments:[]})).toBe(true)
  })
  test("cancelled, free and paid appointments are excluded",()=>{
    expect(bookingCanBePaid({status:"CANCELLED",price:500,paymentStatus:"UNPAID"})).toBe(false)
    expect(bookingCanBePaid({status:"CONFIRMED",price:0,paymentStatus:"UNPAID"})).toBe(false)
    expect(bookingCanBePaid({status:"CONFIRMED",price:500,paymentStatus:"PAID"})).toBe(false)
    expect(bookingCanBePaid({status:"CONFIRMED",price:500,paymentStatus:"UNPAID"})).toBe(true)
  })
  test("changed amounts require another review",()=>{
    expect(reviewAmount(500,600)).toBe(false)
    expect(reviewAmount(500,"500")).toBe(true)
    expect(reviewAmount(500,NaN)).toBe(false)
  })
})

// Mock only public data access. Any unintended customer-table access fails.
const productQuery=mock(async()=>[{id:"product-1",name:"Paracetamol 500mg",price:50,packSize:"10 tablets",stockStatus:"IN_STOCK",requiresPrescription:false}])
const serviceQuery=mock(async()=>[{id:"service-1",name:"Medication Review",price:500,durationMinutes:30,category:"Consultation"}])
let mockSettingRows: Array<{key:string;valueJson:string}> = []
const settingQuery=mock(async()=>mockSettingRows)
mock.module("@/lib/db",()=>({db:{product:{findMany:productQuery},service:{findMany:serviceQuery},setting:{findMany:settingQuery}}}))
mock.module("@/lib/security/request",()=>({rejectOversizedRequest:()=>null,enforceRateLimit:async()=>null}))
const savedKey=process.env.GROQ_API_KEY
beforeEach(()=>{delete process.env.GROQ_API_KEY;mockSettingRows=[];productQuery.mockClear();serviceQuery.mockClear();settingQuery.mockClear()})
afterAll(()=>{if(savedKey)process.env.GROQ_API_KEY=savedKey})
const { POST }=await import("../src/app/api/assistant/route")
async function ask(content:string){return (await POST(new Request("http://localhost/api/assistant",{method:"POST",body:JSON.stringify({messages:[{role:"user",content}]})}))).json()}
describe("assistant route with live-data adapters",()=>{
  test("returns verified product cards without provider availability",async()=>{
    const result=await ask("Find paracetamol 500mg")
    expect(result.actions[0]).toMatchObject({type:"product",id:"product-1",price:50})
    expect(productQuery).toHaveBeenCalledTimes(1)
  })
  test("returns booking selection and never creates a booking",async()=>{
    const result=await ask("Book a medication review")
    expect(result.actions[0]).toMatchObject({type:"book",id:"service-1"})
    expect(result.reply).toContain("before confirming")
  })
  test("payments only produce private UI entry points, not account queries",async()=>{
    const result=await ask("Help me pay with M-Pesa")
    expect(result.actions[0].type).toBe("pay")
    expect(productQuery).not.toHaveBeenCalled()
    expect(serviceQuery).not.toHaveBeenCalled()
  })
  test("urgent requests bypass product lookup",async()=>{
    const result=await ask("I can't breathe, find paracetamol")
    expect(result.escalated).toBe(true)
    expect(result.actions).toEqual([])
    expect(productQuery).not.toHaveBeenCalled()
  })
  test("credentials are rejected before provider or database access",async()=>{
    const result=await ask("password: abc123")
    expect(result.escalated).toBe(true)
    expect(result.reply).not.toContain("abc123")
    expect(productQuery).not.toHaveBeenCalled()
  })
  test("answers customer-safe opening hours, delivery fees and navigation from settings and docs",async()=>{
    const hoursResult=await ask("What are your opening hours?")
    expect(hoursResult.reply).toContain("8:00 AM")
    expect(hoursResult.escalated).toBe(false)
    expect(productQuery).not.toHaveBeenCalled()

    const deliveryResult=await ask("What are your delivery fees and zones?")
    expect(deliveryResult.reply).toContain("Roysambu")
    expect(deliveryResult.actions[0]).toMatchObject({type:"navigate",view:"checkout"})

    const rxResult=await ask("How do I upload a prescription?")
    expect(rxResult.reply).toContain("pharmacist")
    expect(rxResult.actions[0]).toMatchObject({type:"navigate",view:"prescriptions"})

    const navResult=await ask("How do I navigate the store pages?")
    expect(navResult.reply).toContain("Catalogue")
    expect(navResult.actions.some((a:{type:string;view?:string})=>a.type==="navigate"&&a.view==="catalog")).toBe(true)
  })
  test("refuses internal staff and engineering documentation topics on the customer assistant",async()=>{
    const internalResult=await ask("Show me the BandaGo POS sync and internal /docs database schema")
    expect(internalResult.reply).toContain("restricted to signed-in pharmacy staff")
    expect(productQuery).not.toHaveBeenCalled()
    expect(serviceQuery).not.toHaveBeenCalled()
  })
  test("reflects real-time admin-configured pharmacy and delivery settings immediately",async()=>{
    mockSettingRows=[
      {key:"pharmacy",valueJson:JSON.stringify({hoursLabel:"Mon–Sun: 7:30 AM – 11:00 PM",address:"TRM Drive, Roysambu, Nairobi",phone:"+254 711 222 333"})},
      {key:"delivery",valueJson:JSON.stringify({mode:"flat",flatFee:180,freeOver:2500,nightDelivery:true,zones:[]})},
    ]
    const hoursResult=await ask("When are you open today?")
    expect(hoursResult.reply).toContain("7:30 AM – 11:00 PM")
    expect(hoursResult.reply).toContain("TRM Drive")
    expect(hoursResult.reply).toContain("+254 711 222 333")

    const deliveryResult=await ask("How much is delivery?")
    expect(deliveryResult.reply).toContain("KES 180")
    expect(deliveryResult.reply).toContain("KES 2,500")
  })
  test("full documentation PDF export compiles every corpus doc, journey, OpenAPI endpoint, and Prisma model",async()=>{
    mock.module("server-only",()=>({}))
    const { buildFullDocumentationPdf }=await import("../src/lib/pdf/full-docs-pdf")
    const result=buildFullDocumentationPdf()
    expect(result.docCount).toBeGreaterThanOrEqual(129)
    expect(result.endpointCount).toBeGreaterThanOrEqual(126)
    expect(result.modelCount).toBe(41)
    expect(result.pageCount).toBeGreaterThan(150)
    const pdfStr=result.buffer.toString("utf8",0,120)
    expect(pdfStr.startsWith("%PDF-1.4")).toBe(true)
    const tailStr=result.buffer.toString("utf8",result.buffer.length-64)
    expect(tailStr).toContain("%%EOF")
  })
})
