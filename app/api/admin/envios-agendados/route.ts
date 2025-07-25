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

    // Buscar envios agendados das próximas 24 horas
    const envios = await executeQuery(
      `SELECT 
        ea.id,
        ea.data_agendamento,
        ea.tentativas,
        ea.status as envio_status,
        c.nome as cliente_nome,
        c.telefone as cliente_telefone,
        i.name as instance_name,
        i.status as instancia_status,
        TIMESTAMPDIFF(MINUTE, NOW(), ea.data_agendamento) as minutos_para_envio,
        ea.created_at,
        ea.updated_at
      FROM envios_agendados ea
      INNER JOIN clientes c ON ea.cliente_id = c.id
      INNER JOIN instances i ON ea.instance_id = i.id
      WHERE ea.status IN ('pendente', 'reagendado')
        AND ea.data_agendamento >= NOW()
        AND ea.data_agendamento <= NOW() + INTERVAL 24 HOUR
      ORDER BY ea.data_agendamento ASC
      LIMIT 50`,
      []
    ) as RowDataPacket[]

    // Buscar estatísticas dos envios agendados
    const estatisticas = await executeQuery(
      `SELECT 
        COUNT(*) as total_agendados,
        COUNT(CASE WHEN status = 'pendente' THEN 1 END) as pendentes,
        COUNT(CASE WHEN status = 'enviado' THEN 1 END) as enviados,
        COUNT(CASE WHEN status = 'erro' THEN 1 END) as com_erro,
        COUNT(CASE WHEN status = 'reagendado' THEN 1 END) as reagendados,
        COUNT(CASE WHEN data_agendamento < NOW() AND status IN ('pendente', 'reagendado') THEN 1 END) as atrasados,
        COUNT(CASE WHEN data_agendamento BETWEEN NOW() AND NOW() + INTERVAL 1 HOUR THEN 1 END) as proxima_hora,
        COUNT(CASE WHEN tentativas > 0 THEN 1 END) as com_tentativas
      FROM envios_agendados
      WHERE data_agendamento >= NOW() - INTERVAL 24 HOUR`,
      []
    ) as RowDataPacket[]

    // Buscar próximos envios por instância
    const porInstancia = await executeQuery(
      `SELECT 
        i.name as instance_name,
        i.status as instancia_status,
        COUNT(*) as total_agendados,
        MIN(ea.data_agendamento) as proximo_envio
      FROM envios_agendados ea
      INNER JOIN instances i ON ea.instance_id = i.id
      WHERE ea.status IN ('pendente', 'reagendado')
        AND ea.data_agendamento >= NOW()
        AND ea.data_agendamento <= NOW() + INTERVAL 24 HOUR
      GROUP BY i.id, i.name, i.status
      ORDER BY proximo_envio ASC`,
      []
    ) as RowDataPacket[]

    return NextResponse.json({
      success: true,
      envios: envios || [],
      estatisticas: estatisticas[0] || {},
      por_instancia: porInstancia || [],
      periodo: 'Próximas 24 horas'
    })

  } catch (error) {
    console.error('Erro ao buscar envios agendados:', error)
    return NextResponse.json(
      { 
        error: 'Erro interno do servidor',
        details: error instanceof Error ? error.message : 'Erro desconhecido'
      },
      { status: 500 }
    )
  }
}

// Endpoint para reagendar ou cancelar envios
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

    const { action, envio_id, nova_data } = await request.json()

    if (action === 'reagendar' && envio_id && nova_data) {
      // Reagendar envio
      await executeQuery(
        `UPDATE envios_agendados 
        SET 
          data_agendamento = ?,
          status = 'reagendado',
          updated_at = NOW()
        WHERE id = ?
          AND status IN ('pendente', 'reagendado')`,
        [nova_data, envio_id]
      )

      return NextResponse.json({
        success: true,
        message: 'Envio reagendado com sucesso'
      })
    }

    if (action === 'cancelar' && envio_id) {
      // Cancelar envio
      await executeQuery(
        `UPDATE envios_agendados 
        SET 
          status = 'cancelado',
          updated_at = NOW()
        WHERE id = ?
          AND status IN ('pendente', 'reagendado')`,
        [envio_id]
      )

      return NextResponse.json({
        success: true,
        message: 'Envio cancelado com sucesso'
      })
    }

    if (action === 'limpar_antigos') {
      // Limpar envios antigos (mais de 7 dias)
      const result = await executeQuery(
        `DELETE FROM envios_agendados 
        WHERE data_agendamento < NOW() - INTERVAL 7 DAY
          AND status IN ('enviado', 'erro', 'cancelado')`,
        []
      )

      return NextResponse.json({
        success: true,
        message: `${(result as any).affectedRows} envios antigos removidos`
      })
    }

    return NextResponse.json(
      { error: 'Ação não reconhecida ou parâmetros inválidos' },
      { status: 400 }
    )

  } catch (error) {
    console.error('Erro ao processar ação:', error)
    return NextResponse.json(
      { 
        error: 'Erro interno do servidor',
        details: error instanceof Error ? error.message : 'Erro desconhecido'
      },
      { status: 500 }
    )
  }
}