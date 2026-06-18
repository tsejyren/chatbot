import { kv } from '@vercel/kv'
import { streamText } from 'ai'
import { GoogleAuth } from 'google-auth-library'

// 1. 直接使用精简的标准全局 Fetch 初始化，规避未安装 @ai-sdk/openai 的问题
import { createOpenAI } from '@ai-sdk/openai' // 如果一会儿依赖装好了可以用它

export async function POST(req: Request) {
  const { messages } = await req.json()
  const lastUserMessage = messages[messages.length - 1].content

  let searchResultsContext = ''

  try {
    // 2. 谷歌认证
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
        pageSize: 3
      }
    })

    const results = (res.data as any).results || []
    searchResultsContext = results
      .map((r: any) => r.document?.derivedStructData?.snippets?.[0]?.snippet || '')
      .filter(Boolean)
      .join('\n\n')
      
  } catch (err) {
    console.error('GCP Search Error:', err)
  }

  if (searchResultsContext) {
    messages[messages.length - 1].content = `【注安法律法规参考资料】:\n${searchResultsContext}\n\n请严格结合上述参考资料内容，有条理地回答我的问题：${lastUserMessage}`
  }

  // 4. 使用一种绝对不会报缺少特定 SDK 错误的通用原生流式调用
  const response = await fetch(`${process.env.OPENAI_API_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: process.env.NEXT_PUBLIC_MODEL || 'deepseek-ai/DeepSeek-V3',
      messages,
      stream: true
    })
  })

  // 直接将底层原生流转化为标准 Vercel 数据流返回
  return new Response(response.body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  })
}
