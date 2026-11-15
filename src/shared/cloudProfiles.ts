import type {AppSettings} from './contracts'

export const CLOUD_SETTING_KEYS = ['textBaseUrl','textApiProtocol','textModel','visionBaseUrl','visionModel',
  'contextWindow','textInputPricePerMillion','textOutputPricePerMillion','visionInputPricePerMillion',
  'visionOutputPricePerMillion','imagePrice'] as const
export type CloudProviderSettings = Pick<AppSettings,typeof CLOUD_SETTING_KEYS[number]>
export type CloudProfileSummary = {id:string;name:string}
export function cloudProviderSettings(settings:AppSettings):CloudProviderSettings {
  return Object.fromEntries(CLOUD_SETTING_KEYS.map(key=>[key,settings[key]])) as CloudProviderSettings
}
export const EMPTY_CLOUD_SETTINGS:CloudProviderSettings={textBaseUrl:'',textApiProtocol:'responses',textModel:'',
  visionBaseUrl:'',visionModel:'',contextWindow:128000,textInputPricePerMillion:null,textOutputPricePerMillion:null,
  visionInputPricePerMillion:null,visionOutputPricePerMillion:null,imagePrice:null}
