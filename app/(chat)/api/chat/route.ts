import { kv } from '@vercel/kv'
import { streamText } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { GoogleAuth } from 'google-auth-library'

export const runtime = 'edge'

// 1. 初始化自定义的七牛云（OpenAI 兼容型）提供商
const qiniuOpenai = createOpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  baseURL: process.env.OPENAI_API_BASE
})

export async function POST(req: Request) {
  const { messages } = await req.json()
  
  // 拿到最新的用户提问
  const lastUserMessage = messages[messages.length - 1].content

  let searchResultsContext = ''

  try {
    // 2. 使用你的 JSON 钥匙串初始化谷歌认证
    const auth = new GoogleAuth({
      credentials: {
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, '\n')
      },
      scopes: ['https://www.googleapis.com/auth/cloud-platform']
    })
    
    const client = await auth.getClient()
    const projectId = process.env.GOOGLE_PROJECT_ID
    const dataStoreId = process.env.GOOGLE_DATA_STORE_ID
    
    // 3. 请求谷歌云标准版检索接口
    const searchUrl = `https://discoveryengine.googleapis.com/v1alpha/projects/${projectId}/locations/global/dataStores/${dataStoreId}/servingConfigs/default_search:search`
    
    const res = await client.request({
      url: searchUrl,
      method: 'POST',
      data: {
        query: lastUserMessage,
        pageSize: 3 // 每次只捞取最相关的 3 条法条切片
      }
    })

    // 4. 解析谷歌返回的 Markdown 原文片段
    const results = (res.data as any).results || []
    searchResultsContext = results
      .map((r: any) => r.document?.derivedStructData?.snippets?.[0]?.snippet || '')
      .filter(Boolean)
      .join('\n\n')
      
  } catch (err) {
    console.error('GCP Search Error, 降级为纯模型对话:', err)
  }

  // 5. 如果抓到了法条，把它当做“强力知识背景”注入给七牛云大模型
  if (searchResultsContext) {
    messages[messages.length - 1].content = `【注安法律法规参考资料】:\n${searchResultsContext}\n\n请严格结合上述参考资料内容，有条理地回答我的问题：${lastUserMessage}`
  }

  // 6. 使用最新版标准的 streamText 调用七牛云里的大模型进行流式回答
  const result = streamText({
    model: qiniuOpenai(process.env.NEXT_PUBLIC_MODEL || 'deepseek-ai/DeepSeek-V3'),
    messages
  })

  return result.toDataStreamResponse()
}
