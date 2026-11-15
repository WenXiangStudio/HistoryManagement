import {it,expect} from 'vitest'
import {processingRoute,validateResearchReport,type VideoClassification} from './videoWorkflow'

it('unknown classification stops and manual review overrides detection',()=>{
  expect(processingRoute()).toBe('review')
  expect(processingRoute({code:'visual'} as VideoClassification)).toBe('manual')
  expect(processingRoute({code:'pending',manualReview:{code:'speech'}} as VideoClassification)).toBe('speech')
})
it('report requires exact body quotes for both viewpoints and inferred domains',()=>{
  const value={overview:'总结',analysis:'分析',keyPoints:[{viewpoint:'观点',explanation:'分析',quotes:['先验证字段']}],
    domains:[{name:'软件工程',reasoning:'推测',quotes:['完成展示']}],limitations:[]}
  expect(validateResearchReport(value,'作者认为先验证字段归属，再完成展示。')).toEqual(value)
  expect(()=>validateResearchReport({...value,domains:[{...value.domains[0],quotes:['不存在的引文']}]},'作者认为先验证字段归属，再完成展示。')).toThrow('研究报告引用与正文不符')
})
