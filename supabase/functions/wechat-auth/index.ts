// Supabase Edge Function：微信静默登录
// 部署: supabase functions deploy wechat-auth --no-verify-jwt
// 需配置 secrets: WECHAT_APP_ID, WECHAT_APP_SECRET
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  try {
    const { code } = await req.json()
    if (!code) return new Response(JSON.stringify({ error: '缺少 code' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

    const appId = Deno.env.get('WECHAT_APP_ID')
    const appSecret = Deno.env.get('WECHAT_APP_SECRET')
    if (!appId || !appSecret) return new Response(JSON.stringify({ error: '未配置微信 APP_ID/APP_SECRET' }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

    const url = `https://api.weixin.qq.com/sns/jscode2session?appid=${appId}&secret=${appSecret}&js_code=${code}&grant_type=authorization_code`
    const wxRes = await fetch(url)
    const wxData = await wxRes.json()
    if (wxData.errcode) return new Response(JSON.stringify({ error: wxData.errmsg || '微信接口错误' }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

    const { openid, unionid, session_key } = wxData
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    const { data: profile } = await supabase.from('user_profiles').upsert(
      {
        user_id: null,
        platform: 'wechat_miniprogram',
        openid,
        unionid: unionid || null,
        extra_data: { session_key },
        updated_at: new Date().toISOString()
      },
      { onConflict: 'platform,openid' }
    ).select('id, openid').single()

    return new Response(JSON.stringify({ openid, profileId: profile?.id }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }
})
