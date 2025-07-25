import { NextRequest, NextResponse } from 'next/server'
import { executeQuery } from '@/lib/db'
import { getAuthUser } from '@/lib/auth'
import { RowDataPacket } from 'mysql2'

export async function GET(request: NextRequest) {
  try {
    // Verificar autenticação
    const user = await getAuthUser()
    if (!user || user.tipo !== 'admin') {
      return NextResponse.json(
        { error: 'Não autorizado' },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const page = parseInt(searchParams.get('page') || '1')
    const limit = parseInt(searchParams.get('limit') || '50')
    const offset = (page - 1) * limit

    // Buscar logs de cron com paginação
    const logs = await executeQuery(
      `SELECT 
        id,
        tipo_cron,
        status,
        mensagem,
        detalhes,
        tempo_execucao,
        created_at
      FROM cron_logs 
      ORDER BY created_at DESC 
      LIMIT ? OFFSET ?`,
      [limit, offset]
    ) as RowDataPacket[]

    // Contar total de logs
    const totalResult = await executeQuery(
      `SELECT COUNT(*) as total FROM cron_logs`,
      []
    ) as RowDataPacket[]
    
    const total = totalResult[0]?.total || 0

    // Buscar estatísticas dos últimos 7 dias
    const estatisticas = await executeQuery(
      `SELECT 
        tipo_cron,
        COUNT(*) as total_execucoes,
        COUNT(CASE WHEN status = 'sucesso' THEN 1 END) as sucessos,
        COUNT(CASE WHEN status = 'erro' THEN 1 END) as erros,
        AVG(tempo_execucao) as tempo_medio
      FROM cron_logs 
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      GROUP BY tipo_cron
      ORDER BY total_execucoes DESC`,
      []
    ) as RowDataPacket[]

    return NextResponse.json({
      success: true,
      logs,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      },
      estatisticas
    })

  } catch (error) {
    console.error('Erro ao buscar logs de cron:', error)
    return NextResponse.json(
      { 
        error: 'Erro interno do servidor',
        details: error instanceof Error ? error.message : 'Erro desconhecido'
      },
      { status: 500 }
    )
  }
}

// Endpoint para limpar logs antigos
export async function DELETE(request: NextRequest) {
  try {
    // Verificar autenticação
    const user = await getAuthUser()
    if (!user || user.tipo !== 'admin') {
      return NextResponse.json(
        { error: 'Não autorizado' },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(request.url)
    const dias = parseInt(searchParams.get('dias') || '30')

    // Limpar logs mais antigos que X dias
    const result = await executeQuery(
      `DELETE FROM cron_logs 
      WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [dias]
    )

    return NextResponse.json({
      success: true,
      message: `${(result as any).affectedRows} logs removidos com sucesso`
    })

  } catch (error) {
    console.error('Erro ao limpar logs:', error)
    return NextResponse.json(
      { 
        error: 'Erro interno do servidor',
        details: error instanceof Error ? error.message : 'Erro desconhecido'
      },
      { status: 500 }
    )
  }
}