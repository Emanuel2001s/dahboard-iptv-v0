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

    // Buscar estatísticas de execução dos crons nas últimas 24 horas
    const execucoes_recentes = await executeQuery(
      `SELECT 
        tipo_cron,
        status,
        COUNT(*) as quantidade,
        AVG(tempo_execucao) as tempo_medio,
        MAX(created_at) as ultima_execucao
      FROM cron_logs 
      WHERE created_at >= NOW() - INTERVAL 24 HOUR
      GROUP BY tipo_cron, status
      ORDER BY ultima_execucao DESC`,
      []
    ) as RowDataPacket[]

    // Buscar últimas execuções de cada tipo de cron
    const ultimas_execucoes = await executeQuery(
      `SELECT 
        cl1.tipo_cron,
        cl1.status,
        cl1.mensagem,
        cl1.tempo_execucao,
        cl1.created_at
      FROM cron_logs cl1
      INNER JOIN (
        SELECT tipo_cron, MAX(created_at) as max_created_at
        FROM cron_logs
        GROUP BY tipo_cron
      ) cl2 ON cl1.tipo_cron = cl2.tipo_cron AND cl1.created_at = cl2.max_created_at
      ORDER BY cl1.created_at DESC`,
      []
    ) as RowDataPacket[]

    // Buscar estatísticas gerais do sistema
    const estatisticas_gerais = await executeQuery(
      `SELECT 
        COUNT(DISTINCT tipo_cron) as tipos_cron_ativos,
        COUNT(*) as total_execucoes_historico,
        COUNT(CASE WHEN status = 'sucesso' THEN 1 END) as total_sucessos,
        COUNT(CASE WHEN status = 'erro' THEN 1 END) as total_erros,
        AVG(tempo_execucao) as tempo_medio_geral,
        MAX(created_at) as ultima_atividade
      FROM cron_logs
      WHERE created_at >= NOW() - INTERVAL 7 DAY`,
      []
    ) as RowDataPacket[]

    return NextResponse.json({
      success: true,
      execucoes_recentes,
      ultimas_execucoes,
      estatisticas_gerais: estatisticas_gerais[0] || {},
      periodo_analise: '24 horas'
    })

  } catch (error) {
    console.error('Erro ao buscar estatísticas de cron:', error)
    return NextResponse.json(
      { 
        error: 'Erro interno do servidor',
        details: error instanceof Error ? error.message : 'Erro desconhecido'
      },
      { status: 500 }
    )
  }
}

// Endpoint para registrar execução de cron
export async function POST(request: NextRequest) {
  try {
    // Verificar autenticação
    const user = await getAuthUser()
    if (!user || user.tipo !== 'admin') {
      return NextResponse.json(
        { error: 'Não autorizado' },
        { status: 401 }
      )
    }

    const { tipo_cron, status, mensagem, detalhes, tempo_execucao } = await request.json()

    // Validar dados obrigatórios
    if (!tipo_cron || !status) {
      return NextResponse.json(
        { error: 'Tipo de cron e status são obrigatórios' },
        { status: 400 }
      )
    }

    // Inserir log de execução
    await executeQuery(
      `INSERT INTO cron_logs (
        tipo_cron, 
        status, 
        mensagem, 
        detalhes, 
        tempo_execucao,
        created_at
      ) VALUES (?, ?, ?, ?, ?, NOW())`,
      [
        tipo_cron,
        status,
        mensagem || null,
        detalhes || null,
        tempo_execucao || null
      ]
    )

    return NextResponse.json({
      success: true,
      message: 'Log de cron registrado com sucesso'
    })

  } catch (error) {
    console.error('Erro ao registrar log de cron:', error)
    return NextResponse.json(
      { 
        error: 'Erro interno do servidor',
        details: error instanceof Error ? error.message : 'Erro desconhecido'
      },
      { status: 500 }
    )
  }
}