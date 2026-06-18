import { GoogleAuth } from 'google-auth-library'

export async function POST(req: Request) {
  const { messages } = await req.json()
  const lastUserMessage = messages[messages.length - 1].content

  let searchResultsContext = ''

  try {
    // 1. 谷歌云认证
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
    
    // 2. 请求谷歌云标准版检索接口
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

  // 3. 注入参考资料
  if (searchResultsContext) {
    messages[messages.length - 1].content = `【注安法律法规参考资料】:\n${searchResultsContext}\n\n请严格结合上述参考资料内容，有条理地回答我的问题：${lastUserMessage}`
  }

  // 4. 纯原生管道流式调用七牛云
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

  return new Response(response.body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' }
  })
}
