export const SILICON_FLOW_BASE_URL='https://api.siliconflow.cn/v1'
export type SiliconFlowModel={model:string;visionEnabled:boolean}
export type SiliconFlowSlot=SiliconFlowModel&{slot:number;profileId:string|null;profileName:string;hasSecret:boolean}
export type SiliconFlowView={baseUrl:string;protocol:'chat-completions';revision:string;hasSecret:boolean;slots:SiliconFlowSlot[]}
export type SiliconFlowInput={expectedRevision:string;secret:string;models:(SiliconFlowModel&{slot?:number})[];deletedSlots?:number[]}
