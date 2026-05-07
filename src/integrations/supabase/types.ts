export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      asaas_webhook_eventos: {
        Row: {
          event_id: string | null
          evento: string
          id: string
          payload: Json
          payment_id: string | null
          processado_em: string | null
          recebido_em: string
          status: string | null
        }
        Insert: {
          event_id?: string | null
          evento: string
          id?: string
          payload: Json
          payment_id?: string | null
          processado_em?: string | null
          recebido_em?: string
          status?: string | null
        }
        Update: {
          event_id?: string | null
          evento?: string
          id?: string
          payload?: Json
          payment_id?: string | null
          processado_em?: string | null
          recebido_em?: string
          status?: string | null
        }
        Relationships: []
      }
      audit_logs: {
        Row: {
          action: string
          actor_email: string | null
          actor_id: string | null
          created_at: string
          id: string
          ip_address: string | null
          metadata: Json | null
          target_id: string | null
          target_type: string | null
          user_agent: string | null
        }
        Insert: {
          action: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          target_id?: string | null
          target_type?: string | null
          user_agent?: string | null
        }
        Update: {
          action?: string
          actor_email?: string | null
          actor_id?: string | null
          created_at?: string
          id?: string
          ip_address?: string | null
          metadata?: Json | null
          target_id?: string | null
          target_type?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      autorizacao_cartoes: {
        Row: {
          ativo: boolean
          codigo_hash: string
          created_at: string
          criado_por: string | null
          funcao: string | null
          funcionario_id: string | null
          id: string
          observacoes: string | null
          owner_id: string
          revogado_em: string | null
          revogado_por: string | null
          rotulo: string
          updated_at: string
          usado_em: string | null
          user_id: string | null
        }
        Insert: {
          ativo?: boolean
          codigo_hash: string
          created_at?: string
          criado_por?: string | null
          funcao?: string | null
          funcionario_id?: string | null
          id?: string
          observacoes?: string | null
          owner_id: string
          revogado_em?: string | null
          revogado_por?: string | null
          rotulo: string
          updated_at?: string
          usado_em?: string | null
          user_id?: string | null
        }
        Update: {
          ativo?: boolean
          codigo_hash?: string
          created_at?: string
          criado_por?: string | null
          funcao?: string | null
          funcionario_id?: string | null
          id?: string
          observacoes?: string | null
          owner_id?: string
          revogado_em?: string | null
          revogado_por?: string | null
          rotulo?: string
          updated_at?: string
          usado_em?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "autorizacao_cartoes_funcionario_id_fkey"
            columns: ["funcionario_id"]
            isOneToOne: false
            referencedRelation: "funcionarios"
            referencedColumns: ["id"]
          },
        ]
      }
      autorizacoes_config: {
        Row: {
          codigo_qr_hash: string | null
          codigo_qr_label: string | null
          created_at: string
          exigir_alterar_valor_confirmado: boolean
          exigir_cancelar_compra: boolean
          exigir_cancelar_venda: boolean
          exigir_excluir_lancamento_financeiro: boolean
          exigir_fechar_caixa_divergencia: boolean
          exigir_fechar_caixa_qualquer: boolean
          exigir_reabrir_caixa: boolean
          exigir_remover_item_venda: boolean
          exigir_sangria_caixa: boolean
          exigir_suprimento_caixa: boolean
          metodo_codigo_qr_habilitado: boolean
          metodo_pin_habilitado: boolean
          metodo_senha_master_habilitado: boolean
          owner_id: string
          papeis_autorizadores: Database["public"]["Enums"]["app_role"][]
          senha_master_hash: string | null
          updated_at: string
        }
        Insert: {
          codigo_qr_hash?: string | null
          codigo_qr_label?: string | null
          created_at?: string
          exigir_alterar_valor_confirmado?: boolean
          exigir_cancelar_compra?: boolean
          exigir_cancelar_venda?: boolean
          exigir_excluir_lancamento_financeiro?: boolean
          exigir_fechar_caixa_divergencia?: boolean
          exigir_fechar_caixa_qualquer?: boolean
          exigir_reabrir_caixa?: boolean
          exigir_remover_item_venda?: boolean
          exigir_sangria_caixa?: boolean
          exigir_suprimento_caixa?: boolean
          metodo_codigo_qr_habilitado?: boolean
          metodo_pin_habilitado?: boolean
          metodo_senha_master_habilitado?: boolean
          owner_id: string
          papeis_autorizadores?: Database["public"]["Enums"]["app_role"][]
          senha_master_hash?: string | null
          updated_at?: string
        }
        Update: {
          codigo_qr_hash?: string | null
          codigo_qr_label?: string | null
          created_at?: string
          exigir_alterar_valor_confirmado?: boolean
          exigir_cancelar_compra?: boolean
          exigir_cancelar_venda?: boolean
          exigir_excluir_lancamento_financeiro?: boolean
          exigir_fechar_caixa_divergencia?: boolean
          exigir_fechar_caixa_qualquer?: boolean
          exigir_reabrir_caixa?: boolean
          exigir_remover_item_venda?: boolean
          exigir_sangria_caixa?: boolean
          exigir_suprimento_caixa?: boolean
          metodo_codigo_qr_habilitado?: boolean
          metodo_pin_habilitado?: boolean
          metodo_senha_master_habilitado?: boolean
          owner_id?: string
          papeis_autorizadores?: Database["public"]["Enums"]["app_role"][]
          senha_master_hash?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      autorizacoes_log: {
        Row: {
          acao: Database["public"]["Enums"]["autorizacao_acao"]
          autorizador_funcionario_id: string | null
          autorizador_nome: string | null
          autorizador_user_id: string | null
          contexto: string
          contexto_dados: Json
          created_at: string
          diferenca_caixa: number | null
          id: string
          ip_address: string | null
          metodo: Database["public"]["Enums"]["autorizacao_metodo"]
          motivo_negacao: string | null
          owner_id: string
          referencia_id: string | null
          referencia_tipo: string | null
          solicitante_funcionario_id: string | null
          solicitante_user_id: string | null
          status: Database["public"]["Enums"]["autorizacao_status"]
          terminal_id: string | null
          user_agent: string | null
          valor_envolvido: number | null
        }
        Insert: {
          acao: Database["public"]["Enums"]["autorizacao_acao"]
          autorizador_funcionario_id?: string | null
          autorizador_nome?: string | null
          autorizador_user_id?: string | null
          contexto: string
          contexto_dados?: Json
          created_at?: string
          diferenca_caixa?: number | null
          id?: string
          ip_address?: string | null
          metodo: Database["public"]["Enums"]["autorizacao_metodo"]
          motivo_negacao?: string | null
          owner_id: string
          referencia_id?: string | null
          referencia_tipo?: string | null
          solicitante_funcionario_id?: string | null
          solicitante_user_id?: string | null
          status: Database["public"]["Enums"]["autorizacao_status"]
          terminal_id?: string | null
          user_agent?: string | null
          valor_envolvido?: number | null
        }
        Update: {
          acao?: Database["public"]["Enums"]["autorizacao_acao"]
          autorizador_funcionario_id?: string | null
          autorizador_nome?: string | null
          autorizador_user_id?: string | null
          contexto?: string
          contexto_dados?: Json
          created_at?: string
          diferenca_caixa?: number | null
          id?: string
          ip_address?: string | null
          metodo?: Database["public"]["Enums"]["autorizacao_metodo"]
          motivo_negacao?: string | null
          owner_id?: string
          referencia_id?: string | null
          referencia_tipo?: string | null
          solicitante_funcionario_id?: string | null
          solicitante_user_id?: string | null
          status?: Database["public"]["Enums"]["autorizacao_status"]
          terminal_id?: string | null
          user_agent?: string | null
          valor_envolvido?: number | null
        }
        Relationships: []
      }
      balanca_config: {
        Row: {
          ativo: boolean
          casas_decimais_peso: number
          casas_decimais_valor: number
          comprimento_total: number
          created_at: string
          digitos_codigo_produto: number
          digitos_peso_valor: number
          inicio_codigo_produto: number
          inicio_peso_valor: number
          observacoes: string | null
          owner_id: string
          prefixos: string[]
          tipo_codigo: string
          updated_at: string
          validar_dv: boolean
        }
        Insert: {
          ativo?: boolean
          casas_decimais_peso?: number
          casas_decimais_valor?: number
          comprimento_total?: number
          created_at?: string
          digitos_codigo_produto?: number
          digitos_peso_valor?: number
          inicio_codigo_produto?: number
          inicio_peso_valor?: number
          observacoes?: string | null
          owner_id: string
          prefixos?: string[]
          tipo_codigo?: string
          updated_at?: string
          validar_dv?: boolean
        }
        Update: {
          ativo?: boolean
          casas_decimais_peso?: number
          casas_decimais_valor?: number
          comprimento_total?: number
          created_at?: string
          digitos_codigo_produto?: number
          digitos_peso_valor?: number
          inicio_codigo_produto?: number
          inicio_peso_valor?: number
          observacoes?: string | null
          owner_id?: string
          prefixos?: string[]
          tipo_codigo?: string
          updated_at?: string
          validar_dv?: boolean
        }
        Relationships: []
      }
      caixa_movimentos: {
        Row: {
          caixa_id: string
          client_uuid: string | null
          created_at: string
          id: string
          motivo: string | null
          operador_id: string | null
          owner_id: string
          terminal_id: string | null
          tipo: Database["public"]["Enums"]["caixa_movimento_tipo"]
          usuario_id: string | null
          valor: number
          venda_id: string | null
        }
        Insert: {
          caixa_id: string
          client_uuid?: string | null
          created_at?: string
          id?: string
          motivo?: string | null
          operador_id?: string | null
          owner_id: string
          terminal_id?: string | null
          tipo: Database["public"]["Enums"]["caixa_movimento_tipo"]
          usuario_id?: string | null
          valor: number
          venda_id?: string | null
        }
        Update: {
          caixa_id?: string
          client_uuid?: string | null
          created_at?: string
          id?: string
          motivo?: string | null
          operador_id?: string | null
          owner_id?: string
          terminal_id?: string | null
          tipo?: Database["public"]["Enums"]["caixa_movimento_tipo"]
          usuario_id?: string | null
          valor?: number
          venda_id?: string | null
        }
        Relationships: []
      }
      caixas: {
        Row: {
          created_at: string
          data_abertura: string
          data_fechamento: string | null
          diferenca: number | null
          id: string
          observacao: string | null
          observacao_fechamento: string | null
          operador_id: string | null
          owner_id: string
          qtd_vendas: number
          status: Database["public"]["Enums"]["caixa_status"]
          terminal_id: string | null
          total_boleto: number
          total_credito: number
          total_debito: number
          total_dinheiro: number
          total_fiado: number
          total_ifood: number
          total_outros: number
          total_pix: number
          total_sangrias: number
          total_suprimentos: number
          total_vendas: number
          updated_at: string
          usuario_id: string
          valor_esperado: number | null
          valor_informado: number | null
          valor_inicial: number
        }
        Insert: {
          created_at?: string
          data_abertura?: string
          data_fechamento?: string | null
          diferenca?: number | null
          id?: string
          observacao?: string | null
          observacao_fechamento?: string | null
          operador_id?: string | null
          owner_id: string
          qtd_vendas?: number
          status?: Database["public"]["Enums"]["caixa_status"]
          terminal_id?: string | null
          total_boleto?: number
          total_credito?: number
          total_debito?: number
          total_dinheiro?: number
          total_fiado?: number
          total_ifood?: number
          total_outros?: number
          total_pix?: number
          total_sangrias?: number
          total_suprimentos?: number
          total_vendas?: number
          updated_at?: string
          usuario_id: string
          valor_esperado?: number | null
          valor_informado?: number | null
          valor_inicial?: number
        }
        Update: {
          created_at?: string
          data_abertura?: string
          data_fechamento?: string | null
          diferenca?: number | null
          id?: string
          observacao?: string | null
          observacao_fechamento?: string | null
          operador_id?: string | null
          owner_id?: string
          qtd_vendas?: number
          status?: Database["public"]["Enums"]["caixa_status"]
          terminal_id?: string | null
          total_boleto?: number
          total_credito?: number
          total_debito?: number
          total_dinheiro?: number
          total_fiado?: number
          total_ifood?: number
          total_outros?: number
          total_pix?: number
          total_sangrias?: number
          total_suprimentos?: number
          total_vendas?: number
          updated_at?: string
          usuario_id?: string
          valor_esperado?: number | null
          valor_informado?: number | null
          valor_inicial?: number
        }
        Relationships: []
      }
      categorias_financeiras: {
        Row: {
          ativo: boolean
          client_uuid: string | null
          cor: string | null
          created_at: string
          id: string
          nome: string
          owner_id: string
          parent_id: string | null
          tipo: Database["public"]["Enums"]["categoria_financeira_tipo"]
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          client_uuid?: string | null
          cor?: string | null
          created_at?: string
          id?: string
          nome: string
          owner_id: string
          parent_id?: string | null
          tipo: Database["public"]["Enums"]["categoria_financeira_tipo"]
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          client_uuid?: string | null
          cor?: string | null
          created_at?: string
          id?: string
          nome?: string
          owner_id?: string
          parent_id?: string | null
          tipo?: Database["public"]["Enums"]["categoria_financeira_tipo"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categorias_financeiras_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categorias_financeiras"
            referencedColumns: ["id"]
          },
        ]
      }
      categorias_produto: {
        Row: {
          ativo: boolean
          client_uuid: string | null
          created_at: string
          descricao: string | null
          id: string
          nome: string
          owner_id: string
          parent_id: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          client_uuid?: string | null
          created_at?: string
          descricao?: string | null
          id?: string
          nome: string
          owner_id: string
          parent_id?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          client_uuid?: string | null
          created_at?: string
          descricao?: string | null
          id?: string
          nome?: string
          owner_id?: string
          parent_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "categorias_produto_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "categorias_produto"
            referencedColumns: ["id"]
          },
        ]
      }
      clientes: {
        Row: {
          bairro: string | null
          celular: string | null
          cep: string | null
          cidade: string | null
          client_uuid: string | null
          complemento: string | null
          created_at: string
          data_nascimento: string | null
          documento: string | null
          email: string | null
          estado: string | null
          id: string
          inscricao_estadual: string | null
          logradouro: string | null
          nome: string
          nome_fantasia: string | null
          numero: string | null
          observacoes: string | null
          owner_id: string
          status: Database["public"]["Enums"]["cadastro_status"]
          telefone: string | null
          tipo: Database["public"]["Enums"]["pessoa_tipo"]
          updated_at: string
        }
        Insert: {
          bairro?: string | null
          celular?: string | null
          cep?: string | null
          cidade?: string | null
          client_uuid?: string | null
          complemento?: string | null
          created_at?: string
          data_nascimento?: string | null
          documento?: string | null
          email?: string | null
          estado?: string | null
          id?: string
          inscricao_estadual?: string | null
          logradouro?: string | null
          nome: string
          nome_fantasia?: string | null
          numero?: string | null
          observacoes?: string | null
          owner_id: string
          status?: Database["public"]["Enums"]["cadastro_status"]
          telefone?: string | null
          tipo?: Database["public"]["Enums"]["pessoa_tipo"]
          updated_at?: string
        }
        Update: {
          bairro?: string | null
          celular?: string | null
          cep?: string | null
          cidade?: string | null
          client_uuid?: string | null
          complemento?: string | null
          created_at?: string
          data_nascimento?: string | null
          documento?: string | null
          email?: string | null
          estado?: string | null
          id?: string
          inscricao_estadual?: string | null
          logradouro?: string | null
          nome?: string
          nome_fantasia?: string | null
          numero?: string | null
          observacoes?: string | null
          owner_id?: string
          status?: Database["public"]["Enums"]["cadastro_status"]
          telefone?: string | null
          tipo?: Database["public"]["Enums"]["pessoa_tipo"]
          updated_at?: string
        }
        Relationships: []
      }
      cobranca_whatsapp_logs: {
        Row: {
          cliente_id: string | null
          created_at: string
          empresa_id: string
          erro: string | null
          id: string
          lancamento_id: string | null
          mensagem: string
          owner_id: string
          sent_at: string | null
          status: Database["public"]["Enums"]["cobranca_wa_status"]
          telefone: string | null
          tipo: Database["public"]["Enums"]["cobranca_wa_tipo"]
        }
        Insert: {
          cliente_id?: string | null
          created_at?: string
          empresa_id: string
          erro?: string | null
          id?: string
          lancamento_id?: string | null
          mensagem: string
          owner_id: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["cobranca_wa_status"]
          telefone?: string | null
          tipo?: Database["public"]["Enums"]["cobranca_wa_tipo"]
        }
        Update: {
          cliente_id?: string | null
          created_at?: string
          empresa_id?: string
          erro?: string | null
          id?: string
          lancamento_id?: string | null
          mensagem?: string
          owner_id?: string
          sent_at?: string | null
          status?: Database["public"]["Enums"]["cobranca_wa_status"]
          telefone?: string | null
          tipo?: Database["public"]["Enums"]["cobranca_wa_tipo"]
        }
        Relationships: []
      }
      compra_itens: {
        Row: {
          compra_id: string
          created_at: string
          desconto: number
          descricao: string | null
          id: string
          lote_id: string | null
          owner_id: string
          preco_unitario: number
          produto_id: string
          quantidade: number
          quantidade_recebida: number
          total: number
          updated_at: string
          variacao_id: string | null
        }
        Insert: {
          compra_id: string
          created_at?: string
          desconto?: number
          descricao?: string | null
          id?: string
          lote_id?: string | null
          owner_id: string
          preco_unitario?: number
          produto_id: string
          quantidade: number
          quantidade_recebida?: number
          total?: number
          updated_at?: string
          variacao_id?: string | null
        }
        Update: {
          compra_id?: string
          created_at?: string
          desconto?: number
          descricao?: string | null
          id?: string
          lote_id?: string | null
          owner_id?: string
          preco_unitario?: number
          produto_id?: string
          quantidade?: number
          quantidade_recebida?: number
          total?: number
          updated_at?: string
          variacao_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "compra_itens_compra_id_fkey"
            columns: ["compra_id"]
            isOneToOne: false
            referencedRelation: "compras"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compra_itens_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "lotes_produto"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compra_itens_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "lotes_produto_com_saldo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compra_itens_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "compra_itens_variacao_id_fkey"
            columns: ["variacao_id"]
            isOneToOne: false
            referencedRelation: "produto_variacoes"
            referencedColumns: ["id"]
          },
        ]
      }
      compras: {
        Row: {
          created_at: string
          data_emissao: string
          data_prevista: string | null
          data_recebimento: string | null
          data_vencimento: string | null
          desconto: number
          fornecedor_id: string | null
          frete: number
          id: string
          numero: string
          numero_nf: string | null
          observacoes: string | null
          observacoes_json: Json | null
          outros: number
          owner_id: string
          serie_nf: string | null
          status: Database["public"]["Enums"]["compra_status"]
          subtotal: number
          total: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          data_emissao?: string
          data_prevista?: string | null
          data_recebimento?: string | null
          data_vencimento?: string | null
          desconto?: number
          fornecedor_id?: string | null
          frete?: number
          id?: string
          numero: string
          numero_nf?: string | null
          observacoes?: string | null
          observacoes_json?: Json | null
          outros?: number
          owner_id: string
          serie_nf?: string | null
          status?: Database["public"]["Enums"]["compra_status"]
          subtotal?: number
          total?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          data_emissao?: string
          data_prevista?: string | null
          data_recebimento?: string | null
          data_vencimento?: string | null
          desconto?: number
          fornecedor_id?: string | null
          frete?: number
          id?: string
          numero?: string
          numero_nf?: string | null
          observacoes?: string | null
          observacoes_json?: Json | null
          outros?: number
          owner_id?: string
          serie_nf?: string | null
          status?: Database["public"]["Enums"]["compra_status"]
          subtotal?: number
          total?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "compras_fornecedor_id_fkey"
            columns: ["fornecedor_id"]
            isOneToOne: false
            referencedRelation: "fornecedores"
            referencedColumns: ["id"]
          },
        ]
      }
      config_comercial: {
        Row: {
          asaas_ambiente: string
          asaas_enabled: boolean
          dias_trial: number
          id: boolean
          permitir_modulos_no_trial: boolean
          plano_padrao_id: string | null
          updated_at: string
          valor_padrao_sistema: number
        }
        Insert: {
          asaas_ambiente?: string
          asaas_enabled?: boolean
          dias_trial?: number
          id?: boolean
          permitir_modulos_no_trial?: boolean
          plano_padrao_id?: string | null
          updated_at?: string
          valor_padrao_sistema?: number
        }
        Update: {
          asaas_ambiente?: string
          asaas_enabled?: boolean
          dias_trial?: number
          id?: boolean
          permitir_modulos_no_trial?: boolean
          plano_padrao_id?: string | null
          updated_at?: string
          valor_padrao_sistema?: number
        }
        Relationships: [
          {
            foreignKeyName: "config_comercial_plano_padrao_id_fkey"
            columns: ["plano_padrao_id"]
            isOneToOne: false
            referencedRelation: "planos"
            referencedColumns: ["id"]
          },
        ]
      }
      configuracoes_empresa: {
        Row: {
          bairro: string | null
          cep: string | null
          cidade: string | null
          cnpj: string | null
          complemento: string | null
          created_at: string
          email: string | null
          estado: string | null
          id: string
          inscricao_estadual: string | null
          inscricao_municipal: string | null
          logo_url: string | null
          logradouro: string | null
          nome_fantasia: string | null
          numero: string | null
          owner_id: string
          razao_social: string
          telefone: string | null
          updated_at: string
        }
        Insert: {
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          cnpj?: string | null
          complemento?: string | null
          created_at?: string
          email?: string | null
          estado?: string | null
          id?: string
          inscricao_estadual?: string | null
          inscricao_municipal?: string | null
          logo_url?: string | null
          logradouro?: string | null
          nome_fantasia?: string | null
          numero?: string | null
          owner_id: string
          razao_social: string
          telefone?: string | null
          updated_at?: string
        }
        Update: {
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          cnpj?: string | null
          complemento?: string | null
          created_at?: string
          email?: string | null
          estado?: string | null
          id?: string
          inscricao_estadual?: string | null
          inscricao_municipal?: string | null
          logo_url?: string | null
          logradouro?: string | null
          nome_fantasia?: string | null
          numero?: string | null
          owner_id?: string
          razao_social?: string
          telefone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      empresa_assinaturas: {
        Row: {
          created_at: string
          data_expiracao: string | null
          data_inicio: string
          empresa_id: string
          id: string
          observacoes: string | null
          plano_id: string | null
          status: Database["public"]["Enums"]["assinatura_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          data_expiracao?: string | null
          data_inicio?: string
          empresa_id: string
          id?: string
          observacoes?: string | null
          plano_id?: string | null
          status?: Database["public"]["Enums"]["assinatura_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          data_expiracao?: string | null
          data_inicio?: string
          empresa_id?: string
          id?: string
          observacoes?: string | null
          plano_id?: string | null
          status?: Database["public"]["Enums"]["assinatura_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "empresa_assinaturas_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: true
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "empresa_assinaturas_plano_id_fkey"
            columns: ["plano_id"]
            isOneToOne: false
            referencedRelation: "planos"
            referencedColumns: ["id"]
          },
        ]
      }
      empresa_integracoes: {
        Row: {
          ativo: boolean
          configuracoes: Json
          created_at: string
          empresa_id: string
          erro_ultimo_sync: string | null
          id: string
          nome_exibicao: string | null
          owner_id: string
          status: Database["public"]["Enums"]["integracao_status"]
          tipo_integracao: Database["public"]["Enums"]["integracao_tipo"]
          ultimo_sync_at: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          configuracoes?: Json
          created_at?: string
          empresa_id: string
          erro_ultimo_sync?: string | null
          id?: string
          nome_exibicao?: string | null
          owner_id: string
          status?: Database["public"]["Enums"]["integracao_status"]
          tipo_integracao: Database["public"]["Enums"]["integracao_tipo"]
          ultimo_sync_at?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          configuracoes?: Json
          created_at?: string
          empresa_id?: string
          erro_ultimo_sync?: string | null
          id?: string
          nome_exibicao?: string | null
          owner_id?: string
          status?: Database["public"]["Enums"]["integracao_status"]
          tipo_integracao?: Database["public"]["Enums"]["integracao_tipo"]
          ultimo_sync_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      empresa_membros: {
        Row: {
          convidado_por: string | null
          created_at: string
          email: string | null
          empresa_id: string
          id: string
          nome: string | null
          papel: Database["public"]["Enums"]["empresa_papel"]
          telefone: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          convidado_por?: string | null
          created_at?: string
          email?: string | null
          empresa_id: string
          id?: string
          nome?: string | null
          papel?: Database["public"]["Enums"]["empresa_papel"]
          telefone?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          convidado_por?: string | null
          created_at?: string
          email?: string | null
          empresa_id?: string
          id?: string
          nome?: string | null
          papel?: Database["public"]["Enums"]["empresa_papel"]
          telefone?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "empresa_membros_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
        ]
      }
      empresa_modulos: {
        Row: {
          created_at: string
          data_expiracao: string | null
          data_inicio: string
          empresa_id: string
          id: string
          modulo_id: string
          observacoes: string | null
          status: Database["public"]["Enums"]["empresa_modulo_status"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          data_expiracao?: string | null
          data_inicio?: string
          empresa_id: string
          id?: string
          modulo_id: string
          observacoes?: string | null
          status?: Database["public"]["Enums"]["empresa_modulo_status"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          data_expiracao?: string | null
          data_inicio?: string
          empresa_id?: string
          id?: string
          modulo_id?: string
          observacoes?: string | null
          status?: Database["public"]["Enums"]["empresa_modulo_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "empresa_modulos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "empresa_modulos_modulo_id_fkey"
            columns: ["modulo_id"]
            isOneToOne: false
            referencedRelation: "modulos"
            referencedColumns: ["id"]
          },
        ]
      }
      empresas: {
        Row: {
          asaas_customer_id: string | null
          bloqueada_em: string | null
          bloqueada_motivo: string | null
          created_at: string
          documento: string | null
          email: string | null
          id: string
          nome: string
          observacoes: string | null
          owner_id: string
          plano: string
          status: string
          telefone: string | null
          updated_at: string
        }
        Insert: {
          asaas_customer_id?: string | null
          bloqueada_em?: string | null
          bloqueada_motivo?: string | null
          created_at?: string
          documento?: string | null
          email?: string | null
          id?: string
          nome: string
          observacoes?: string | null
          owner_id: string
          plano?: string
          status?: string
          telefone?: string | null
          updated_at?: string
        }
        Update: {
          asaas_customer_id?: string | null
          bloqueada_em?: string | null
          bloqueada_motivo?: string | null
          created_at?: string
          documento?: string | null
          email?: string | null
          id?: string
          nome?: string
          observacoes?: string | null
          owner_id?: string
          plano?: string
          status?: string
          telefone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      estoque_movimentacoes: {
        Row: {
          client_uuid: string | null
          compra_id: string | null
          created_at: string
          custo_unitario: number | null
          data_movimentacao: string
          id: string
          lote_id: string | null
          observacoes: string | null
          origem: Database["public"]["Enums"]["movimentacao_origem"]
          owner_id: string
          produto_id: string
          quantidade: number
          saldo_anterior: number | null
          saldo_posterior: number | null
          tipo: Database["public"]["Enums"]["movimentacao_tipo"]
          variacao_id: string | null
          venda_id: string | null
        }
        Insert: {
          client_uuid?: string | null
          compra_id?: string | null
          created_at?: string
          custo_unitario?: number | null
          data_movimentacao?: string
          id?: string
          lote_id?: string | null
          observacoes?: string | null
          origem?: Database["public"]["Enums"]["movimentacao_origem"]
          owner_id: string
          produto_id: string
          quantidade: number
          saldo_anterior?: number | null
          saldo_posterior?: number | null
          tipo: Database["public"]["Enums"]["movimentacao_tipo"]
          variacao_id?: string | null
          venda_id?: string | null
        }
        Update: {
          client_uuid?: string | null
          compra_id?: string | null
          created_at?: string
          custo_unitario?: number | null
          data_movimentacao?: string
          id?: string
          lote_id?: string | null
          observacoes?: string | null
          origem?: Database["public"]["Enums"]["movimentacao_origem"]
          owner_id?: string
          produto_id?: string
          quantidade?: number
          saldo_anterior?: number | null
          saldo_posterior?: number | null
          tipo?: Database["public"]["Enums"]["movimentacao_tipo"]
          variacao_id?: string | null
          venda_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "estoque_movimentacoes_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "lotes_produto"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoque_movimentacoes_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "lotes_produto_com_saldo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoque_movimentacoes_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "estoque_movimentacoes_variacao_id_fkey"
            columns: ["variacao_id"]
            isOneToOne: false
            referencedRelation: "produto_variacoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_movs_compra"
            columns: ["compra_id"]
            isOneToOne: false
            referencedRelation: "compras"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fk_movs_venda"
            columns: ["venda_id"]
            isOneToOne: false
            referencedRelation: "vendas"
            referencedColumns: ["id"]
          },
        ]
      }
      financeiro_lancamentos: {
        Row: {
          caixa_id: string | null
          categoria_id: string | null
          client_uuid: string | null
          cliente_id: string | null
          compra_id: string | null
          conciliado_em: string | null
          conciliado_por: string | null
          created_at: string
          data_emissao: string
          data_pagamento: string | null
          data_vencimento: string
          descricao: string
          forma_pagamento: Database["public"]["Enums"]["forma_pagamento"] | null
          fornecedor_id: string | null
          id: string
          numero_documento: string | null
          numero_repasse: string | null
          observacao_repasse: string | null
          observacoes: string | null
          owner_id: string
          parcela_numero: number | null
          parcela_total: number | null
          repasse_id: string | null
          status: Database["public"]["Enums"]["lancamento_status"]
          taxa_repasse: number | null
          tipo: Database["public"]["Enums"]["lancamento_tipo"]
          updated_at: string
          valor: number
          valor_pago: number
          valor_repasse: number | null
          venda_id: string | null
        }
        Insert: {
          caixa_id?: string | null
          categoria_id?: string | null
          client_uuid?: string | null
          cliente_id?: string | null
          compra_id?: string | null
          conciliado_em?: string | null
          conciliado_por?: string | null
          created_at?: string
          data_emissao?: string
          data_pagamento?: string | null
          data_vencimento: string
          descricao: string
          forma_pagamento?:
            | Database["public"]["Enums"]["forma_pagamento"]
            | null
          fornecedor_id?: string | null
          id?: string
          numero_documento?: string | null
          numero_repasse?: string | null
          observacao_repasse?: string | null
          observacoes?: string | null
          owner_id: string
          parcela_numero?: number | null
          parcela_total?: number | null
          repasse_id?: string | null
          status?: Database["public"]["Enums"]["lancamento_status"]
          taxa_repasse?: number | null
          tipo: Database["public"]["Enums"]["lancamento_tipo"]
          updated_at?: string
          valor: number
          valor_pago?: number
          valor_repasse?: number | null
          venda_id?: string | null
        }
        Update: {
          caixa_id?: string | null
          categoria_id?: string | null
          client_uuid?: string | null
          cliente_id?: string | null
          compra_id?: string | null
          conciliado_em?: string | null
          conciliado_por?: string | null
          created_at?: string
          data_emissao?: string
          data_pagamento?: string | null
          data_vencimento?: string
          descricao?: string
          forma_pagamento?:
            | Database["public"]["Enums"]["forma_pagamento"]
            | null
          fornecedor_id?: string | null
          id?: string
          numero_documento?: string | null
          numero_repasse?: string | null
          observacao_repasse?: string | null
          observacoes?: string | null
          owner_id?: string
          parcela_numero?: number | null
          parcela_total?: number | null
          repasse_id?: string | null
          status?: Database["public"]["Enums"]["lancamento_status"]
          taxa_repasse?: number | null
          tipo?: Database["public"]["Enums"]["lancamento_tipo"]
          updated_at?: string
          valor?: number
          valor_pago?: number
          valor_repasse?: number | null
          venda_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "financeiro_lancamentos_caixa_id_fkey"
            columns: ["caixa_id"]
            isOneToOne: false
            referencedRelation: "caixas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financeiro_lancamentos_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categorias_financeiras"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financeiro_lancamentos_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financeiro_lancamentos_compra_id_fkey"
            columns: ["compra_id"]
            isOneToOne: false
            referencedRelation: "compras"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financeiro_lancamentos_fornecedor_id_fkey"
            columns: ["fornecedor_id"]
            isOneToOne: false
            referencedRelation: "fornecedores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "financeiro_lancamentos_venda_id_fkey"
            columns: ["venda_id"]
            isOneToOne: false
            referencedRelation: "vendas"
            referencedColumns: ["id"]
          },
        ]
      }
      fornecedores: {
        Row: {
          bairro: string | null
          cep: string | null
          cidade: string | null
          client_uuid: string | null
          complemento: string | null
          contato_nome: string | null
          created_at: string
          documento: string | null
          email: string | null
          estado: string | null
          id: string
          inscricao_estadual: string | null
          logradouro: string | null
          nome_fantasia: string | null
          numero: string | null
          observacoes: string | null
          owner_id: string
          razao_social: string
          status: Database["public"]["Enums"]["cadastro_status"]
          telefone: string | null
          tipo: Database["public"]["Enums"]["pessoa_tipo"]
          updated_at: string
        }
        Insert: {
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          client_uuid?: string | null
          complemento?: string | null
          contato_nome?: string | null
          created_at?: string
          documento?: string | null
          email?: string | null
          estado?: string | null
          id?: string
          inscricao_estadual?: string | null
          logradouro?: string | null
          nome_fantasia?: string | null
          numero?: string | null
          observacoes?: string | null
          owner_id: string
          razao_social: string
          status?: Database["public"]["Enums"]["cadastro_status"]
          telefone?: string | null
          tipo?: Database["public"]["Enums"]["pessoa_tipo"]
          updated_at?: string
        }
        Update: {
          bairro?: string | null
          cep?: string | null
          cidade?: string | null
          client_uuid?: string | null
          complemento?: string | null
          contato_nome?: string | null
          created_at?: string
          documento?: string | null
          email?: string | null
          estado?: string | null
          id?: string
          inscricao_estadual?: string | null
          logradouro?: string | null
          nome_fantasia?: string | null
          numero?: string | null
          observacoes?: string | null
          owner_id?: string
          razao_social?: string
          status?: Database["public"]["Enums"]["cadastro_status"]
          telefone?: string | null
          tipo?: Database["public"]["Enums"]["pessoa_tipo"]
          updated_at?: string
        }
        Relationships: []
      }
      funcionario_lockouts: {
        Row: {
          bloqueado_ate: string | null
          funcionario_id: string
          janela_iniciada_em: string | null
          owner_id: string
          tentativas_na_janela: number
          total_bloqueios: number
          ultima_tentativa_em: string | null
          updated_at: string
        }
        Insert: {
          bloqueado_ate?: string | null
          funcionario_id: string
          janela_iniciada_em?: string | null
          owner_id: string
          tentativas_na_janela?: number
          total_bloqueios?: number
          ultima_tentativa_em?: string | null
          updated_at?: string
        }
        Update: {
          bloqueado_ate?: string | null
          funcionario_id?: string
          janela_iniciada_em?: string | null
          owner_id?: string
          tentativas_na_janela?: number
          total_bloqueios?: number
          ultima_tentativa_em?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      funcionario_tentativas_pin: {
        Row: {
          client_uuid: string | null
          created_at: string
          funcionario_id: string
          id: string
          ip_address: string | null
          owner_id: string
          sucesso: boolean
          terminal_id: string | null
          user_agent: string | null
        }
        Insert: {
          client_uuid?: string | null
          created_at?: string
          funcionario_id: string
          id?: string
          ip_address?: string | null
          owner_id: string
          sucesso: boolean
          terminal_id?: string | null
          user_agent?: string | null
        }
        Update: {
          client_uuid?: string | null
          created_at?: string
          funcionario_id?: string
          id?: string
          ip_address?: string | null
          owner_id?: string
          sucesso?: boolean
          terminal_id?: string | null
          user_agent?: string | null
        }
        Relationships: []
      }
      funcionarios: {
        Row: {
          ativo: boolean
          client_uuid: string | null
          created_at: string
          id: string
          login: string
          nome: string
          owner_id: string
          pin_hash: string
          role: Database["public"]["Enums"]["app_role"]
          ultimo_acesso: string | null
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          client_uuid?: string | null
          created_at?: string
          id?: string
          login: string
          nome: string
          owner_id: string
          pin_hash: string
          role?: Database["public"]["Enums"]["app_role"]
          ultimo_acesso?: string | null
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          client_uuid?: string | null
          created_at?: string
          id?: string
          login?: string
          nome?: string
          owner_id?: string
          pin_hash?: string
          role?: Database["public"]["Enums"]["app_role"]
          ultimo_acesso?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      ifood_repasses: {
        Row: {
          conciliado_por: string | null
          created_at: string
          data_repasse: string
          id: string
          numero_repasse: string | null
          observacao: string | null
          owner_id: string
          qtd_lancamentos: number
          taxa_total: number
          updated_at: string
          valor_bruto: number
          valor_liquido: number
        }
        Insert: {
          conciliado_por?: string | null
          created_at?: string
          data_repasse: string
          id?: string
          numero_repasse?: string | null
          observacao?: string | null
          owner_id: string
          qtd_lancamentos?: number
          taxa_total?: number
          updated_at?: string
          valor_bruto?: number
          valor_liquido?: number
        }
        Update: {
          conciliado_por?: string | null
          created_at?: string
          data_repasse?: string
          id?: string
          numero_repasse?: string | null
          observacao?: string | null
          owner_id?: string
          qtd_lancamentos?: number
          taxa_total?: number
          updated_at?: string
          valor_bruto?: number
          valor_liquido?: number
        }
        Relationships: []
      }
      lancamento_pagamentos: {
        Row: {
          caixa_id: string | null
          client_uuid: string | null
          created_at: string
          data_pagamento: string
          forma_pagamento: Database["public"]["Enums"]["forma_pagamento"] | null
          id: string
          lancamento_id: string
          observacao: string | null
          owner_id: string
          registrado_por: string | null
          valor: number
        }
        Insert: {
          caixa_id?: string | null
          client_uuid?: string | null
          created_at?: string
          data_pagamento?: string
          forma_pagamento?:
            | Database["public"]["Enums"]["forma_pagamento"]
            | null
          id?: string
          lancamento_id: string
          observacao?: string | null
          owner_id: string
          registrado_por?: string | null
          valor: number
        }
        Update: {
          caixa_id?: string | null
          client_uuid?: string | null
          created_at?: string
          data_pagamento?: string
          forma_pagamento?:
            | Database["public"]["Enums"]["forma_pagamento"]
            | null
          id?: string
          lancamento_id?: string
          observacao?: string | null
          owner_id?: string
          registrado_por?: string | null
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "lancamento_pagamentos_lancamento_id_fkey"
            columns: ["lancamento_id"]
            isOneToOne: false
            referencedRelation: "financeiro_lancamentos"
            referencedColumns: ["id"]
          },
        ]
      }
      lotes_produto: {
        Row: {
          client_uuid: string | null
          created_at: string
          custo_unitario: number | null
          data_fabricacao: string | null
          data_validade: string | null
          id: string
          numero_lote: string
          observacoes: string | null
          owner_id: string
          produto_id: string
          quantidade_atual: number
          quantidade_inicial: number
          updated_at: string
          variacao_id: string | null
        }
        Insert: {
          client_uuid?: string | null
          created_at?: string
          custo_unitario?: number | null
          data_fabricacao?: string | null
          data_validade?: string | null
          id?: string
          numero_lote: string
          observacoes?: string | null
          owner_id: string
          produto_id: string
          quantidade_atual?: number
          quantidade_inicial?: number
          updated_at?: string
          variacao_id?: string | null
        }
        Update: {
          client_uuid?: string | null
          created_at?: string
          custo_unitario?: number | null
          data_fabricacao?: string | null
          data_validade?: string | null
          id?: string
          numero_lote?: string
          observacoes?: string | null
          owner_id?: string
          produto_id?: string
          quantidade_atual?: number
          quantidade_inicial?: number
          updated_at?: string
          variacao_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lotes_produto_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lotes_produto_variacao_id_fkey"
            columns: ["variacao_id"]
            isOneToOne: false
            referencedRelation: "produto_variacoes"
            referencedColumns: ["id"]
          },
        ]
      }
      mode_modules: {
        Row: {
          created_at: string
          id: string
          mode_id: string
          module_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          mode_id: string
          module_id: string
        }
        Update: {
          created_at?: string
          id?: string
          mode_id?: string
          module_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "mode_modules_mode_id_fkey"
            columns: ["mode_id"]
            isOneToOne: false
            referencedRelation: "system_modes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mode_modules_module_id_fkey"
            columns: ["module_id"]
            isOneToOne: false
            referencedRelation: "modulos"
            referencedColumns: ["id"]
          },
        ]
      }
      modulos: {
        Row: {
          aplica_restricao: boolean
          ativo: boolean
          chave: string
          created_at: string
          descricao: string | null
          id: string
          nome: string
          ordem: number
          updated_at: string
          valor: number
        }
        Insert: {
          aplica_restricao?: boolean
          ativo?: boolean
          chave: string
          created_at?: string
          descricao?: string | null
          id?: string
          nome: string
          ordem?: number
          updated_at?: string
          valor?: number
        }
        Update: {
          aplica_restricao?: boolean
          ativo?: boolean
          chave?: string
          created_at?: string
          descricao?: string | null
          id?: string
          nome?: string
          ordem?: number
          updated_at?: string
          valor?: number
        }
        Relationships: []
      }
      notificacao_estados: {
        Row: {
          created_at: string
          deleted: boolean
          deleted_at: string | null
          id: string
          notificacao_key: string
          read: boolean
          read_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          deleted?: boolean
          deleted_at?: string | null
          id?: string
          notificacao_key: string
          read?: boolean
          read_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          deleted?: boolean
          deleted_at?: string | null
          id?: string
          notificacao_key?: string
          read?: boolean
          read_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      pagamento_itens: {
        Row: {
          created_at: string
          descricao: string | null
          id: string
          modulo_id: string | null
          pagamento_id: string
          plano_id: string | null
          tipo: Database["public"]["Enums"]["pagamento_referencia"]
          valor: number
        }
        Insert: {
          created_at?: string
          descricao?: string | null
          id?: string
          modulo_id?: string | null
          pagamento_id: string
          plano_id?: string | null
          tipo: Database["public"]["Enums"]["pagamento_referencia"]
          valor?: number
        }
        Update: {
          created_at?: string
          descricao?: string | null
          id?: string
          modulo_id?: string | null
          pagamento_id?: string
          plano_id?: string | null
          tipo?: Database["public"]["Enums"]["pagamento_referencia"]
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "pagamento_itens_modulo_id_fkey"
            columns: ["modulo_id"]
            isOneToOne: false
            referencedRelation: "modulos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagamento_itens_pagamento_id_fkey"
            columns: ["pagamento_id"]
            isOneToOne: false
            referencedRelation: "pagamentos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagamento_itens_plano_id_fkey"
            columns: ["plano_id"]
            isOneToOne: false
            referencedRelation: "planos"
            referencedColumns: ["id"]
          },
        ]
      }
      pagamentos: {
        Row: {
          asaas_billing_type: string | null
          asaas_customer_id: string | null
          asaas_invoice_url: string | null
          asaas_payment_id: string | null
          asaas_pix_copia_cola: string | null
          asaas_pix_qrcode: string | null
          created_at: string
          data_pagamento: string | null
          data_vencimento: string | null
          descricao: string | null
          empresa_id: string
          external_reference: string | null
          forma_pagamento: string | null
          id: string
          modulo_id: string | null
          observacoes: string | null
          plano_id: string | null
          referencia_tipo: Database["public"]["Enums"]["pagamento_referencia"]
          registrado_por: string | null
          status: Database["public"]["Enums"]["pagamento_status"]
          updated_at: string
          valor: number
        }
        Insert: {
          asaas_billing_type?: string | null
          asaas_customer_id?: string | null
          asaas_invoice_url?: string | null
          asaas_payment_id?: string | null
          asaas_pix_copia_cola?: string | null
          asaas_pix_qrcode?: string | null
          created_at?: string
          data_pagamento?: string | null
          data_vencimento?: string | null
          descricao?: string | null
          empresa_id: string
          external_reference?: string | null
          forma_pagamento?: string | null
          id?: string
          modulo_id?: string | null
          observacoes?: string | null
          plano_id?: string | null
          referencia_tipo?: Database["public"]["Enums"]["pagamento_referencia"]
          registrado_por?: string | null
          status?: Database["public"]["Enums"]["pagamento_status"]
          updated_at?: string
          valor?: number
        }
        Update: {
          asaas_billing_type?: string | null
          asaas_customer_id?: string | null
          asaas_invoice_url?: string | null
          asaas_payment_id?: string | null
          asaas_pix_copia_cola?: string | null
          asaas_pix_qrcode?: string | null
          created_at?: string
          data_pagamento?: string | null
          data_vencimento?: string | null
          descricao?: string | null
          empresa_id?: string
          external_reference?: string | null
          forma_pagamento?: string | null
          id?: string
          modulo_id?: string | null
          observacoes?: string | null
          plano_id?: string | null
          referencia_tipo?: Database["public"]["Enums"]["pagamento_referencia"]
          registrado_por?: string | null
          status?: Database["public"]["Enums"]["pagamento_status"]
          updated_at?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "pagamentos_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresas"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagamentos_modulo_id_fkey"
            columns: ["modulo_id"]
            isOneToOne: false
            referencedRelation: "modulos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pagamentos_plano_id_fkey"
            columns: ["plano_id"]
            isOneToOne: false
            referencedRelation: "planos"
            referencedColumns: ["id"]
          },
        ]
      }
      pedidos_externos: {
        Row: {
          cliente_documento: string | null
          cliente_nome: string | null
          cliente_telefone: string | null
          created_at: string
          empresa_id: string
          endereco_entrega: Json | null
          external_id: string
          id: string
          itens: Json
          origem: Database["public"]["Enums"]["pedido_externo_origem"]
          owner_id: string
          raw_payload: Json | null
          sincronizado_em: string | null
          status: string
          updated_at: string
          valor_total: number
          venda_id: string | null
        }
        Insert: {
          cliente_documento?: string | null
          cliente_nome?: string | null
          cliente_telefone?: string | null
          created_at?: string
          empresa_id: string
          endereco_entrega?: Json | null
          external_id: string
          id?: string
          itens?: Json
          origem: Database["public"]["Enums"]["pedido_externo_origem"]
          owner_id: string
          raw_payload?: Json | null
          sincronizado_em?: string | null
          status?: string
          updated_at?: string
          valor_total?: number
          venda_id?: string | null
        }
        Update: {
          cliente_documento?: string | null
          cliente_nome?: string | null
          cliente_telefone?: string | null
          created_at?: string
          empresa_id?: string
          endereco_entrega?: Json | null
          external_id?: string
          id?: string
          itens?: Json
          origem?: Database["public"]["Enums"]["pedido_externo_origem"]
          owner_id?: string
          raw_payload?: Json | null
          sincronizado_em?: string | null
          status?: string
          updated_at?: string
          valor_total?: number
          venda_id?: string | null
        }
        Relationships: []
      }
      pix_cobrancas_geradas: {
        Row: {
          cliente_id: string | null
          copia_cola: string | null
          created_at: string
          empresa_id: string
          id: string
          invoice_url: string | null
          lancamento_id: string | null
          owner_id: string
          paid_at: string | null
          payload_request: Json | null
          payload_response: Json | null
          provider: string
          provider_payment_id: string | null
          qr_code_image: string | null
          status: string
          updated_at: string
          valor: number
          vencimento: string | null
        }
        Insert: {
          cliente_id?: string | null
          copia_cola?: string | null
          created_at?: string
          empresa_id: string
          id?: string
          invoice_url?: string | null
          lancamento_id?: string | null
          owner_id: string
          paid_at?: string | null
          payload_request?: Json | null
          payload_response?: Json | null
          provider: string
          provider_payment_id?: string | null
          qr_code_image?: string | null
          status?: string
          updated_at?: string
          valor: number
          vencimento?: string | null
        }
        Update: {
          cliente_id?: string | null
          copia_cola?: string | null
          created_at?: string
          empresa_id?: string
          id?: string
          invoice_url?: string | null
          lancamento_id?: string | null
          owner_id?: string
          paid_at?: string | null
          payload_request?: Json | null
          payload_response?: Json | null
          provider?: string
          provider_payment_id?: string | null
          qr_code_image?: string | null
          status?: string
          updated_at?: string
          valor?: number
          vencimento?: string | null
        }
        Relationships: []
      }
      pix_webhook_eventos: {
        Row: {
          event_id: string | null
          id: string
          payload: Json
          payment_id: string | null
          processado_em: string | null
          provider: string
          recebido_em: string
          status: string | null
        }
        Insert: {
          event_id?: string | null
          id?: string
          payload: Json
          payment_id?: string | null
          processado_em?: string | null
          provider: string
          recebido_em?: string
          status?: string | null
        }
        Update: {
          event_id?: string | null
          id?: string
          payload?: Json
          payment_id?: string | null
          processado_em?: string | null
          provider?: string
          recebido_em?: string
          status?: string | null
        }
        Relationships: []
      }
      planos: {
        Row: {
          ativo: boolean
          created_at: string
          descricao: string | null
          id: string
          limite_produtos: number | null
          limite_usuarios: number | null
          nome: string
          ordem: number
          tipo_cobranca: Database["public"]["Enums"]["plano_tipo_cobranca"]
          updated_at: string
          valor: number
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          descricao?: string | null
          id?: string
          limite_produtos?: number | null
          limite_usuarios?: number | null
          nome: string
          ordem?: number
          tipo_cobranca?: Database["public"]["Enums"]["plano_tipo_cobranca"]
          updated_at?: string
          valor?: number
        }
        Update: {
          ativo?: boolean
          created_at?: string
          descricao?: string | null
          id?: string
          limite_produtos?: number | null
          limite_usuarios?: number | null
          nome?: string
          ordem?: number
          tipo_cobranca?: Database["public"]["Enums"]["plano_tipo_cobranca"]
          updated_at?: string
          valor?: number
        }
        Relationships: []
      }
      produto_codigos: {
        Row: {
          client_uuid: string | null
          created_at: string
          id: string
          observacao: string | null
          owner_id: string
          produto_id: string
          tipo_codigo: string
          updated_at: string
          valor_codigo: string
          variacao_id: string | null
        }
        Insert: {
          client_uuid?: string | null
          created_at?: string
          id?: string
          observacao?: string | null
          owner_id: string
          produto_id: string
          tipo_codigo: string
          updated_at?: string
          valor_codigo: string
          variacao_id?: string | null
        }
        Update: {
          client_uuid?: string | null
          created_at?: string
          id?: string
          observacao?: string | null
          owner_id?: string
          produto_id?: string
          tipo_codigo?: string
          updated_at?: string
          valor_codigo?: string
          variacao_id?: string | null
        }
        Relationships: []
      }
      produto_variacoes: {
        Row: {
          ativo: boolean
          atributos: Json
          client_uuid: string | null
          codigo_barras: string | null
          created_at: string
          id: string
          nome: string
          owner_id: string
          preco_custo: number | null
          preco_venda: number | null
          produto_id: string
          sku: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          atributos?: Json
          client_uuid?: string | null
          codigo_barras?: string | null
          created_at?: string
          id?: string
          nome: string
          owner_id: string
          preco_custo?: number | null
          preco_venda?: number | null
          produto_id: string
          sku: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          atributos?: Json
          client_uuid?: string | null
          codigo_barras?: string | null
          created_at?: string
          id?: string
          nome?: string
          owner_id?: string
          preco_custo?: number | null
          preco_venda?: number | null
          produto_id?: string
          sku?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "produto_variacoes_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
        ]
      }
      produtos: {
        Row: {
          aceita_etiqueta_balanca: boolean
          casas_decimais_quantidade: number
          categoria_id: string | null
          cest: string | null
          client_uuid: string | null
          codigo_barras: string | null
          codigo_interno: string | null
          created_at: string
          descricao: string | null
          estoque_inicial: number
          estoque_minimo: number
          id: string
          imagem_url: string | null
          marca: string | null
          ncm: string | null
          nome: string
          observacao_tecnica: string | null
          origem: string | null
          owner_id: string
          plu: string | null
          preco_custo: number
          preco_venda: number
          qr_code: string | null
          sku: string
          status: Database["public"]["Enums"]["produto_status"]
          tipo_identificacao_principal: string
          unidade: string
          updated_at: string
          vendido_por_peso: boolean
        }
        Insert: {
          aceita_etiqueta_balanca?: boolean
          casas_decimais_quantidade?: number
          categoria_id?: string | null
          cest?: string | null
          client_uuid?: string | null
          codigo_barras?: string | null
          codigo_interno?: string | null
          created_at?: string
          descricao?: string | null
          estoque_inicial?: number
          estoque_minimo?: number
          id?: string
          imagem_url?: string | null
          marca?: string | null
          ncm?: string | null
          nome: string
          observacao_tecnica?: string | null
          origem?: string | null
          owner_id: string
          plu?: string | null
          preco_custo?: number
          preco_venda?: number
          qr_code?: string | null
          sku: string
          status?: Database["public"]["Enums"]["produto_status"]
          tipo_identificacao_principal?: string
          unidade?: string
          updated_at?: string
          vendido_por_peso?: boolean
        }
        Update: {
          aceita_etiqueta_balanca?: boolean
          casas_decimais_quantidade?: number
          categoria_id?: string | null
          cest?: string | null
          client_uuid?: string | null
          codigo_barras?: string | null
          codigo_interno?: string | null
          created_at?: string
          descricao?: string | null
          estoque_inicial?: number
          estoque_minimo?: number
          id?: string
          imagem_url?: string | null
          marca?: string | null
          ncm?: string | null
          nome?: string
          observacao_tecnica?: string | null
          origem?: string | null
          owner_id?: string
          plu?: string | null
          preco_custo?: number
          preco_venda?: number
          qr_code?: string | null
          sku?: string
          status?: Database["public"]["Enums"]["produto_status"]
          tipo_identificacao_principal?: string
          unidade?: string
          updated_at?: string
          vendido_por_peso?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "produtos_categoria_id_fkey"
            columns: ["categoria_id"]
            isOneToOne: false
            referencedRelation: "categorias_produto"
            referencedColumns: ["id"]
          },
        ]
      }
      qa_avaliacoes: {
        Row: {
          created_at: string
          evidencia_url: string | null
          id: string
          item_id: string
          observacao: string | null
          status: Database["public"]["Enums"]["qa_status_avaliacao"]
          testado_em: string | null
          testado_por: string | null
          testado_por_nome: string | null
          updated_at: string
          validacao_id: string
        }
        Insert: {
          created_at?: string
          evidencia_url?: string | null
          id?: string
          item_id: string
          observacao?: string | null
          status?: Database["public"]["Enums"]["qa_status_avaliacao"]
          testado_em?: string | null
          testado_por?: string | null
          testado_por_nome?: string | null
          updated_at?: string
          validacao_id: string
        }
        Update: {
          created_at?: string
          evidencia_url?: string | null
          id?: string
          item_id?: string
          observacao?: string | null
          status?: Database["public"]["Enums"]["qa_status_avaliacao"]
          testado_em?: string | null
          testado_por?: string | null
          testado_por_nome?: string | null
          updated_at?: string
          validacao_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "qa_avaliacoes_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "qa_itens"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "qa_avaliacoes_validacao_id_fkey"
            columns: ["validacao_id"]
            isOneToOne: false
            referencedRelation: "qa_validacoes"
            referencedColumns: ["id"]
          },
        ]
      }
      qa_itens: {
        Row: {
          ativo: boolean
          created_at: string
          critico: boolean
          descricao: string | null
          id: string
          modulo_id: string
          ordem: number
          rota_link: string | null
          severidade: Database["public"]["Enums"]["qa_severidade"]
          titulo: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          critico?: boolean
          descricao?: string | null
          id?: string
          modulo_id: string
          ordem?: number
          rota_link?: string | null
          severidade?: Database["public"]["Enums"]["qa_severidade"]
          titulo: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          critico?: boolean
          descricao?: string | null
          id?: string
          modulo_id?: string
          ordem?: number
          rota_link?: string | null
          severidade?: Database["public"]["Enums"]["qa_severidade"]
          titulo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "qa_itens_modulo_id_fkey"
            columns: ["modulo_id"]
            isOneToOne: false
            referencedRelation: "qa_modulos"
            referencedColumns: ["id"]
          },
        ]
      }
      qa_modulos: {
        Row: {
          ativo: boolean
          chave: string
          created_at: string
          descricao: string | null
          id: string
          nome: string
          ordem: number
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          chave: string
          created_at?: string
          descricao?: string | null
          id?: string
          nome: string
          ordem?: number
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          chave?: string
          created_at?: string
          descricao?: string | null
          id?: string
          nome?: string
          ordem?: number
          updated_at?: string
        }
        Relationships: []
      }
      qa_validacoes: {
        Row: {
          created_at: string
          finalizada_em: string | null
          id: string
          iniciada_em: string
          observacao_final: string | null
          responsavel_id: string | null
          responsavel_nome: string | null
          resumo: Json | null
          status: Database["public"]["Enums"]["qa_validacao_status"]
          titulo: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          finalizada_em?: string | null
          id?: string
          iniciada_em?: string
          observacao_final?: string | null
          responsavel_id?: string | null
          responsavel_nome?: string | null
          resumo?: Json | null
          status?: Database["public"]["Enums"]["qa_validacao_status"]
          titulo: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          finalizada_em?: string | null
          id?: string
          iniciada_em?: string
          observacao_final?: string | null
          responsavel_id?: string | null
          responsavel_nome?: string | null
          resumo?: Json | null
          status?: Database["public"]["Enums"]["qa_validacao_status"]
          titulo?: string
          updated_at?: string
        }
        Relationships: []
      }
      system_modes: {
        Row: {
          ativo: boolean
          chave: string
          created_at: string
          descricao: string | null
          icone: string | null
          id: string
          nome: string
          ordem: number
          rota_inicial: string
          tipo: Database["public"]["Enums"]["system_mode_tipo"]
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          chave: string
          created_at?: string
          descricao?: string | null
          icone?: string | null
          id?: string
          nome: string
          ordem?: number
          rota_inicial?: string
          tipo?: Database["public"]["Enums"]["system_mode_tipo"]
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          chave?: string
          created_at?: string
          descricao?: string | null
          icone?: string | null
          id?: string
          nome?: string
          ordem?: number
          rota_inicial?: string
          tipo?: Database["public"]["Enums"]["system_mode_tipo"]
          updated_at?: string
        }
        Relationships: []
      }
      terminais: {
        Row: {
          ativo: boolean
          created_at: string
          descricao: string | null
          heartbeat_at: string | null
          id: string
          identificador_dispositivo: string | null
          ip_local: string | null
          nome: string
          operador_atual_id: string | null
          operador_atual_nome: string | null
          owner_id: string
          papel: string
          pareamento_token: string | null
          pode_cadastros: boolean
          pode_configuracoes: boolean
          pode_erp: boolean
          pode_financeiro: boolean
          pode_pdv: boolean
          pode_relatorios: boolean
          ultimo_uso: string | null
          updated_at: string
          user_agent: string | null
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          descricao?: string | null
          heartbeat_at?: string | null
          id?: string
          identificador_dispositivo?: string | null
          ip_local?: string | null
          nome: string
          operador_atual_id?: string | null
          operador_atual_nome?: string | null
          owner_id: string
          papel?: string
          pareamento_token?: string | null
          pode_cadastros?: boolean
          pode_configuracoes?: boolean
          pode_erp?: boolean
          pode_financeiro?: boolean
          pode_pdv?: boolean
          pode_relatorios?: boolean
          ultimo_uso?: string | null
          updated_at?: string
          user_agent?: string | null
        }
        Update: {
          ativo?: boolean
          created_at?: string
          descricao?: string | null
          heartbeat_at?: string | null
          id?: string
          identificador_dispositivo?: string | null
          ip_local?: string | null
          nome?: string
          operador_atual_id?: string | null
          operador_atual_nome?: string | null
          owner_id?: string
          papel?: string
          pareamento_token?: string | null
          pode_cadastros?: boolean
          pode_configuracoes?: boolean
          pode_erp?: boolean
          pode_financeiro?: boolean
          pode_pdv?: boolean
          pode_relatorios?: boolean
          ultimo_uso?: string | null
          updated_at?: string
          user_agent?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      venda_itens: {
        Row: {
          codigo_lido: string | null
          created_at: string
          desconto: number
          descricao: string | null
          id: string
          lote_id: string | null
          owner_id: string
          peso_extraido: number | null
          plu_extraido: string | null
          preco_por_kg: number | null
          preco_unitario: number
          produto_id: string
          quantidade: number
          tipo_interpretacao: string | null
          total: number
          updated_at: string
          valor_extraido: number | null
          variacao_id: string | null
          venda_id: string
          vendido_por_peso: boolean
        }
        Insert: {
          codigo_lido?: string | null
          created_at?: string
          desconto?: number
          descricao?: string | null
          id?: string
          lote_id?: string | null
          owner_id: string
          peso_extraido?: number | null
          plu_extraido?: string | null
          preco_por_kg?: number | null
          preco_unitario?: number
          produto_id: string
          quantidade: number
          tipo_interpretacao?: string | null
          total?: number
          updated_at?: string
          valor_extraido?: number | null
          variacao_id?: string | null
          venda_id: string
          vendido_por_peso?: boolean
        }
        Update: {
          codigo_lido?: string | null
          created_at?: string
          desconto?: number
          descricao?: string | null
          id?: string
          lote_id?: string | null
          owner_id?: string
          peso_extraido?: number | null
          plu_extraido?: string | null
          preco_por_kg?: number | null
          preco_unitario?: number
          produto_id?: string
          quantidade?: number
          tipo_interpretacao?: string | null
          total?: number
          updated_at?: string
          valor_extraido?: number | null
          variacao_id?: string | null
          venda_id?: string
          vendido_por_peso?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "venda_itens_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "lotes_produto"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venda_itens_lote_id_fkey"
            columns: ["lote_id"]
            isOneToOne: false
            referencedRelation: "lotes_produto_com_saldo"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venda_itens_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venda_itens_variacao_id_fkey"
            columns: ["variacao_id"]
            isOneToOne: false
            referencedRelation: "produto_variacoes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "venda_itens_venda_id_fkey"
            columns: ["venda_id"]
            isOneToOne: false
            referencedRelation: "vendas"
            referencedColumns: ["id"]
          },
        ]
      }
      venda_pagamentos: {
        Row: {
          created_at: string
          forma_pagamento: Database["public"]["Enums"]["forma_pagamento"]
          id: string
          observacao: string | null
          owner_id: string
          parcelas: number | null
          troco: number | null
          valor: number
          valor_recebido: number | null
          venda_id: string
        }
        Insert: {
          created_at?: string
          forma_pagamento: Database["public"]["Enums"]["forma_pagamento"]
          id?: string
          observacao?: string | null
          owner_id: string
          parcelas?: number | null
          troco?: number | null
          valor: number
          valor_recebido?: number | null
          venda_id: string
        }
        Update: {
          created_at?: string
          forma_pagamento?: Database["public"]["Enums"]["forma_pagamento"]
          id?: string
          observacao?: string | null
          owner_id?: string
          parcelas?: number | null
          troco?: number | null
          valor?: number
          valor_recebido?: number | null
          venda_id?: string
        }
        Relationships: []
      }
      vendas: {
        Row: {
          caixa_id: string | null
          client_uuid: string | null
          cliente_id: string | null
          created_at: string
          data_emissao: string
          data_entrega: string | null
          data_finalizacao: string | null
          desconto: number
          forma_pagamento: Database["public"]["Enums"]["forma_pagamento"] | null
          frete: number
          id: string
          idempotent_replay_count: number
          numero: string
          numero_nf: string | null
          observacoes: string | null
          operador_id: string | null
          outros: number
          owner_id: string
          serie_nf: string | null
          status: Database["public"]["Enums"]["venda_status"]
          status_pagamento: string
          subtotal: number
          terminal_id: string | null
          total: number
          troco: number | null
          updated_at: string
          valor_recebido: number | null
          vendedor_id: string | null
        }
        Insert: {
          caixa_id?: string | null
          client_uuid?: string | null
          cliente_id?: string | null
          created_at?: string
          data_emissao?: string
          data_entrega?: string | null
          data_finalizacao?: string | null
          desconto?: number
          forma_pagamento?:
            | Database["public"]["Enums"]["forma_pagamento"]
            | null
          frete?: number
          id?: string
          idempotent_replay_count?: number
          numero: string
          numero_nf?: string | null
          observacoes?: string | null
          operador_id?: string | null
          outros?: number
          owner_id: string
          serie_nf?: string | null
          status?: Database["public"]["Enums"]["venda_status"]
          status_pagamento?: string
          subtotal?: number
          terminal_id?: string | null
          total?: number
          troco?: number | null
          updated_at?: string
          valor_recebido?: number | null
          vendedor_id?: string | null
        }
        Update: {
          caixa_id?: string | null
          client_uuid?: string | null
          cliente_id?: string | null
          created_at?: string
          data_emissao?: string
          data_entrega?: string | null
          data_finalizacao?: string | null
          desconto?: number
          forma_pagamento?:
            | Database["public"]["Enums"]["forma_pagamento"]
            | null
          frete?: number
          id?: string
          idempotent_replay_count?: number
          numero?: string
          numero_nf?: string | null
          observacoes?: string | null
          operador_id?: string | null
          outros?: number
          owner_id?: string
          serie_nf?: string | null
          status?: Database["public"]["Enums"]["venda_status"]
          status_pagamento?: string
          subtotal?: number
          terminal_id?: string | null
          total?: number
          troco?: number | null
          updated_at?: string
          valor_recebido?: number | null
          vendedor_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "vendas_cliente_id_fkey"
            columns: ["cliente_id"]
            isOneToOne: false
            referencedRelation: "clientes"
            referencedColumns: ["id"]
          },
        ]
      }
      vendas_status_historico: {
        Row: {
          alterado_por: string | null
          created_at: string
          id: string
          motivo: string | null
          origem: string
          owner_id: string
          status_anterior: string | null
          status_novo: string
          venda_id: string
        }
        Insert: {
          alterado_por?: string | null
          created_at?: string
          id?: string
          motivo?: string | null
          origem: string
          owner_id: string
          status_anterior?: string | null
          status_novo: string
          venda_id: string
        }
        Update: {
          alterado_por?: string | null
          created_at?: string
          id?: string
          motivo?: string | null
          origem?: string
          owner_id?: string
          status_anterior?: string | null
          status_novo?: string
          venda_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "vendas_status_historico_venda_id_fkey"
            columns: ["venda_id"]
            isOneToOne: false
            referencedRelation: "vendas"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      lotes_produto_com_saldo: {
        Row: {
          created_at: string | null
          custo_unitario: number | null
          data_fabricacao: string | null
          data_validade: string | null
          id: string | null
          numero_lote: string | null
          observacoes: string | null
          owner_id: string | null
          produto_id: string | null
          produto_nome: string | null
          produto_sku: string | null
          quantidade_atual: number | null
          quantidade_inicial: number | null
          saldo_real: number | null
          status_validade: string | null
          updated_at: string | null
          variacao_id: string | null
          variacao_nome: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lotes_produto_produto_id_fkey"
            columns: ["produto_id"]
            isOneToOne: false
            referencedRelation: "produtos"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lotes_produto_variacao_id_fkey"
            columns: ["variacao_id"]
            isOneToOne: false
            referencedRelation: "produto_variacoes"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      _auth_owner_id: { Args: never; Returns: string }
      _lote_tem_vinculo: { Args: { _lote_id: string }; Returns: boolean }
      _owner_atual_categorias_financeiras: { Args: never; Returns: string }
      _pode_gerenciar_categorias_financeiras: {
        Args: { _owner: string }
        Returns: boolean
      }
      abrir_caixa:
        | {
            Args: { _observacao?: string; _valor_inicial: number }
            Returns: string
          }
        | {
            Args: {
              _observacao?: string
              _operador_id?: string
              _valor_inicial: number
            }
            Returns: string
          }
        | {
            Args: {
              _observacao?: string
              _operador_id?: string
              _terminal_id?: string
              _valor_inicial: number
            }
            Returns: string
          }
      acessa_owner_id: {
        Args: { _owner_id: string; _user_id: string }
        Returns: boolean
      }
      adicionar_membro_por_email: {
        Args: {
          _email: string
          _empresa_id: string
          _papel: Database["public"]["Enums"]["empresa_papel"]
        }
        Returns: Json
      }
      adicionar_produto_codigo: {
        Args: {
          _client_uuid?: string
          _observacao?: string
          _produto_id: string
          _tipo_codigo: string
          _valor_codigo: string
          _variacao_id?: string
        }
        Returns: Json
      }
      admin_delete_empresa: { Args: { _id: string }; Returns: undefined }
      admin_delete_modulo: { Args: { _id: string }; Returns: undefined }
      admin_delete_pagamento: { Args: { _id: string }; Returns: undefined }
      admin_delete_plano: { Args: { _id: string }; Returns: undefined }
      admin_delete_user: { Args: { _user_id: string }; Returns: undefined }
      admin_estatisticas_globais: { Args: never; Returns: Json }
      admin_get_config_comercial: {
        Args: never
        Returns: {
          asaas_ambiente: string
          asaas_enabled: boolean
          dias_trial: number
          id: boolean
          permitir_modulos_no_trial: boolean
          plano_padrao_id: string | null
          updated_at: string
          valor_padrao_sistema: number
        }
        SetofOptions: {
          from: "*"
          to: "config_comercial"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      admin_listar_assinaturas: {
        Args: never
        Returns: {
          data_expiracao: string
          data_inicio: string
          dias_restantes: number
          empresa_id: string
          empresa_nome: string
          empresa_status: string
          id: string
          modulos_ativos: number
          observacoes: string
          plano_id: string
          plano_nome: string
          plano_tipo: string
          plano_valor: number
          status: Database["public"]["Enums"]["assinatura_status"]
          status_efetivo: string
          updated_at: string
        }[]
      }
      admin_listar_audit_logs: {
        Args: { _limit?: number }
        Returns: {
          action: string
          actor_email: string | null
          actor_id: string | null
          created_at: string
          id: string
          ip_address: string | null
          metadata: Json | null
          target_id: string | null
          target_type: string | null
          user_agent: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "audit_logs"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      admin_listar_empresa_modulos: {
        Args: { _empresa_id?: string }
        Returns: {
          aplica_restricao: boolean
          data_expiracao: string
          data_inicio: string
          empresa_id: string
          empresa_nome: string
          id: string
          modulo_chave: string
          modulo_id: string
          modulo_nome: string
          modulo_valor: number
          observacoes: string
          status: Database["public"]["Enums"]["empresa_modulo_status"]
        }[]
      }
      admin_listar_empresas: {
        Args: never
        Returns: {
          created_at: string
          documento: string
          email: string
          id: string
          nome: string
          observacoes: string
          owner_id: string
          plano: string
          status: string
          telefone: string
          total_compras: number
          total_movimentacoes: number
          total_produtos: number
          total_usuarios: number
          total_vendas: number
          updated_at: string
          volume_compras: number
          volume_vendas: number
        }[]
      }
      admin_listar_modulos: {
        Args: never
        Returns: {
          aplica_restricao: boolean
          ativo: boolean
          chave: string
          created_at: string
          descricao: string | null
          id: string
          nome: string
          ordem: number
          updated_at: string
          valor: number
        }[]
        SetofOptions: {
          from: "*"
          to: "modulos"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      admin_listar_pagamentos: {
        Args: { _empresa_id?: string }
        Returns: {
          created_at: string
          data_pagamento: string
          data_vencimento: string
          descricao: string
          empresa_id: string
          empresa_nome: string
          forma_pagamento: string
          id: string
          modulo_id: string
          modulo_nome: string
          observacoes: string
          plano_id: string
          plano_nome: string
          referencia_tipo: Database["public"]["Enums"]["pagamento_referencia"]
          status: Database["public"]["Enums"]["pagamento_status"]
          valor: number
        }[]
      }
      admin_listar_planos: {
        Args: never
        Returns: {
          ativo: boolean
          created_at: string
          descricao: string | null
          id: string
          limite_produtos: number | null
          limite_usuarios: number | null
          nome: string
          ordem: number
          tipo_cobranca: Database["public"]["Enums"]["plano_tipo_cobranca"]
          updated_at: string
          valor: number
        }[]
        SetofOptions: {
          from: "*"
          to: "planos"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      admin_listar_usuarios: {
        Args: never
        Returns: {
          created_at: string
          email: string
          email_confirmed: boolean
          empresa_id: string
          empresa_nome: string
          empresa_plano: string
          empresa_status: string
          last_sign_in_at: string
          roles: string[]
          total_compras: number
          total_produtos: number
          total_vendas: number
          user_id: string
        }[]
      }
      admin_modo_deletar: { Args: { _id: string }; Returns: undefined }
      admin_modo_set_modulos: {
        Args: { _mode_id: string; _module_ids: string[] }
        Returns: undefined
      }
      admin_modo_upsert: {
        Args: {
          _ativo: boolean
          _chave: string
          _descricao: string
          _icone: string
          _id: string
          _nome: string
          _ordem: number
          _rota_inicial: string
          _tipo: Database["public"]["Enums"]["system_mode_tipo"]
        }
        Returns: string
      }
      admin_modos_listar: {
        Args: never
        Returns: {
          ativo: boolean
          chave: string
          descricao: string
          icone: string
          id: string
          modulos: Json
          nome: string
          ordem: number
          rota_inicial: string
          tipo: Database["public"]["Enums"]["system_mode_tipo"]
        }[]
      }
      admin_registrar_pagamento: {
        Args: {
          _data_pagamento: string
          _data_vencimento: string
          _descricao: string
          _empresa_id: string
          _forma_pagamento: string
          _id: string
          _modulo_id: string
          _observacoes: string
          _plano_id: string
          _referencia_tipo: string
          _status: string
          _valor: number
        }
        Returns: string
      }
      admin_remover_empresa_modulo: {
        Args: { _id: string }
        Returns: undefined
      }
      admin_serie_crescimento: {
        Args: { _dias?: number }
        Returns: {
          data: string
          novas_empresas: number
          novos_usuarios: number
          total_empresas_acum: number
          total_usuarios_acum: number
        }[]
      }
      admin_set_assinatura: {
        Args: {
          _data_expiracao: string
          _data_inicio: string
          _empresa_id: string
          _observacoes: string
          _plano_id: string
          _status: string
        }
        Returns: string
      }
      admin_set_config_comercial:
        | {
            Args: {
              _dias_trial: number
              _permitir_modulos_no_trial: boolean
              _plano_padrao_id: string
              _valor_padrao_sistema: number
            }
            Returns: undefined
          }
        | {
            Args: {
              _asaas_ambiente?: string
              _asaas_enabled?: boolean
              _dias_trial: number
              _permitir_modulos_no_trial: boolean
              _plano_padrao_id: string
              _valor_padrao_sistema: number
            }
            Returns: undefined
          }
      admin_set_empresa_modulo: {
        Args: {
          _data_expiracao: string
          _data_inicio: string
          _empresa_id: string
          _modulo_id: string
          _observacoes: string
          _status: string
        }
        Returns: string
      }
      admin_set_empresa_status: {
        Args: { _id: string; _motivo?: string; _status: string }
        Returns: undefined
      }
      admin_set_user_role: {
        Args: {
          _grant?: boolean
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: undefined
      }
      admin_upsert_empresa: {
        Args: {
          _documento?: string
          _email?: string
          _id: string
          _nome: string
          _observacoes?: string
          _plano?: string
          _telefone?: string
        }
        Returns: string
      }
      admin_upsert_modulo: {
        Args: {
          _aplica_restricao: boolean
          _ativo: boolean
          _chave: string
          _descricao: string
          _id: string
          _nome: string
          _ordem: number
          _valor: number
        }
        Returns: string
      }
      admin_upsert_plano: {
        Args: {
          _ativo: boolean
          _descricao: string
          _id: string
          _limite_produtos: number
          _limite_usuarios: number
          _nome: string
          _ordem: number
          _tipo_cobranca: string
          _valor: number
        }
        Returns: string
      }
      ajustar_quantidade_lote: {
        Args: {
          _client_uuid?: string
          _lote_id: string
          _motivo?: string
          _nova_quantidade: number
        }
        Returns: Json
      }
      alterar_status_categoria_financeira: {
        Args: { _ativo: boolean; _categoria_id: string }
        Returns: Json
      }
      alterar_status_categoria_produto: {
        Args: { _ativo: boolean; _categoria_id: string }
        Returns: Json
      }
      alterar_status_cliente: {
        Args: {
          _cliente_id: string
          _status: Database["public"]["Enums"]["cadastro_status"]
        }
        Returns: Json
      }
      alterar_status_compra: {
        Args: { _id: string; _status: string }
        Returns: undefined
      }
      alterar_status_fornecedor: {
        Args: {
          _fornecedor_id: string
          _status: Database["public"]["Enums"]["cadastro_status"]
        }
        Returns: Json
      }
      alterar_status_produto: {
        Args: {
          _produto_id: string
          _status: Database["public"]["Enums"]["produto_status"]
        }
        Returns: Json
      }
      alterar_status_venda: {
        Args: { _motivo?: string; _novo_status: string; _venda_id: string }
        Returns: Json
      }
      alterar_vencimento_lancamento: {
        Args: { _lancamento_id: string; _nova_data: string }
        Returns: Json
      }
      assinatura_status_efetivo: {
        Args: { _empresa_id: string }
        Returns: Json
      }
      atualizar_compra_metadados: {
        Args: {
          _compra_id: string
          _data_prevista?: string
          _data_vencimento?: string
          _fornecedor_id?: string
          _numero_nf?: string
          _observacoes?: string
          _patch_data_prevista?: boolean
          _patch_data_vencimento?: boolean
          _patch_fornecedor_id?: boolean
          _patch_numero_nf?: boolean
          _patch_observacoes?: boolean
          _patch_serie_nf?: boolean
          _serie_nf?: string
        }
        Returns: {
          created_at: string
          data_emissao: string
          data_prevista: string | null
          data_recebimento: string | null
          data_vencimento: string | null
          desconto: number
          fornecedor_id: string | null
          frete: number
          id: string
          numero: string
          numero_nf: string | null
          observacoes: string | null
          observacoes_json: Json | null
          outros: number
          owner_id: string
          serie_nf: string | null
          status: Database["public"]["Enums"]["compra_status"]
          subtotal: number
          total: number
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "compras"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      autorizacao_cartao_criar: {
        Args: {
          _codigo: string
          _funcao?: string
          _funcionario_id?: string
          _observacoes?: string
          _rotulo: string
          _user_id?: string
        }
        Returns: string
      }
      autorizacao_cartao_excluir: { Args: { _id: string }; Returns: undefined }
      autorizacao_cartao_set_ativo: {
        Args: { _ativo: boolean; _id: string }
        Returns: undefined
      }
      autorizacao_resolver_owner: { Args: never; Returns: string }
      autorizacao_validar: {
        Args: {
          _acao: Database["public"]["Enums"]["autorizacao_acao"]
          _contexto: string
          _contexto_dados?: Json
          _diferenca_caixa?: number
          _metodo: Database["public"]["Enums"]["autorizacao_metodo"]
          _payload: Json
          _referencia_id?: string
          _referencia_tipo?: string
          _solicitante_funcionario_id?: string
          _terminal_id?: string
          _user_agent?: string
          _valor_envolvido?: number
        }
        Returns: Json
      }
      autorizacoes_config_obter: {
        Args: never
        Returns: {
          codigo_qr_hash: string | null
          codigo_qr_label: string | null
          created_at: string
          exigir_alterar_valor_confirmado: boolean
          exigir_cancelar_compra: boolean
          exigir_cancelar_venda: boolean
          exigir_excluir_lancamento_financeiro: boolean
          exigir_fechar_caixa_divergencia: boolean
          exigir_fechar_caixa_qualquer: boolean
          exigir_reabrir_caixa: boolean
          exigir_remover_item_venda: boolean
          exigir_sangria_caixa: boolean
          exigir_suprimento_caixa: boolean
          metodo_codigo_qr_habilitado: boolean
          metodo_pin_habilitado: boolean
          metodo_senha_master_habilitado: boolean
          owner_id: string
          papeis_autorizadores: Database["public"]["Enums"]["app_role"][]
          senha_master_hash: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "autorizacoes_config"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      autorizacoes_config_salvar: {
        Args: { _payload: Json }
        Returns: {
          codigo_qr_hash: string | null
          codigo_qr_label: string | null
          created_at: string
          exigir_alterar_valor_confirmado: boolean
          exigir_cancelar_compra: boolean
          exigir_cancelar_venda: boolean
          exigir_excluir_lancamento_financeiro: boolean
          exigir_fechar_caixa_divergencia: boolean
          exigir_fechar_caixa_qualquer: boolean
          exigir_reabrir_caixa: boolean
          exigir_remover_item_venda: boolean
          exigir_sangria_caixa: boolean
          exigir_suprimento_caixa: boolean
          metodo_codigo_qr_habilitado: boolean
          metodo_pin_habilitado: boolean
          metodo_senha_master_habilitado: boolean
          owner_id: string
          papeis_autorizadores: Database["public"]["Enums"]["app_role"][]
          senha_master_hash: string | null
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "autorizacoes_config"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      buscar_produto_por_codigo: {
        Args: { _codigo: string }
        Returns: {
          categoria_id: string
          categoria_nome: string
          codigo_barras: string
          codigo_interno: string
          fonte: string
          nome: string
          preco_custo: number
          preco_venda: number
          produto_id: string
          qr_code: string
          saldo_estoque: number
          sku: string
          status: Database["public"]["Enums"]["produto_status"]
          tipo_identificacao_principal: string
          unidade: string
        }[]
      }
      caixa_aberto_atual: { Args: never; Returns: string }
      caixa_aberto_operador: {
        Args: { _operador_id?: string }
        Returns: string
      }
      caixa_registrar_movimento:
        | {
            Args: {
              _caixa_id: string
              _motivo?: string
              _tipo: string
              _valor: number
            }
            Returns: string
          }
        | {
            Args: {
              _caixa_id: string
              _client_uuid?: string
              _motivo?: string
              _tipo: string
              _valor: number
            }
            Returns: string
          }
      caixa_resumo: { Args: { _caixa_id: string }; Returns: Json }
      calcular_saldo_estoque: {
        Args: { _produto_id: string; _variacao_id?: string }
        Returns: number
      }
      cancelar_lancamento: {
        Args: { _lancamento_id: string; _motivo?: string }
        Returns: Json
      }
      cancelar_venda: {
        Args: { _motivo?: string; _venda_id: string }
        Returns: Json
      }
      cliente_metricas: {
        Args: { _cliente_id?: string }
        Returns: {
          cliente_id: string
          ticket_medio: number
          total_vendas: number
          ultima_venda: string
          valor_total: number
        }[]
      }
      cobranca_pendente_atual: { Args: never; Returns: Json }
      conciliar_ifood_lancamento: {
        Args: {
          _data_repasse: string
          _lancamento_id: string
          _numero_repasse?: string
          _observacao?: string
          _valor_repasse: number
        }
        Returns: string
      }
      conciliar_ifood_lote: {
        Args: {
          _data_repasse: string
          _lancamento_ids: string[]
          _numero_repasse?: string
          _observacao?: string
          _valor_repasse_total: number
        }
        Returns: string
      }
      confirmar_pagamento_asaas: {
        Args: {
          _data_pagamento?: string
          _forma_pagamento?: string
          _pagamento_id: string
        }
        Returns: Json
      }
      criar_categoria_financeira: {
        Args: {
          _client_uuid?: string
          _cor?: string
          _nome: string
          _parent_id?: string
          _tipo: Database["public"]["Enums"]["categoria_financeira_tipo"]
        }
        Returns: Json
      }
      criar_categoria_produto: {
        Args: {
          _client_uuid?: string
          _descricao?: string
          _nome: string
          _parent_id?: string
        }
        Returns: Json
      }
      criar_cliente: {
        Args: {
          _bairro?: string
          _celular?: string
          _cep?: string
          _cidade?: string
          _client_uuid?: string
          _complemento?: string
          _data_nascimento?: string
          _documento?: string
          _email?: string
          _estado?: string
          _inscricao_estadual?: string
          _logradouro?: string
          _nome: string
          _nome_fantasia?: string
          _numero?: string
          _observacoes?: string
          _status?: Database["public"]["Enums"]["cadastro_status"]
          _telefone?: string
          _tipo: Database["public"]["Enums"]["pessoa_tipo"]
        }
        Returns: Json
      }
      criar_compra: { Args: { _payload: Json }; Returns: Json }
      criar_fornecedor: {
        Args: {
          _bairro?: string
          _cep?: string
          _cidade?: string
          _client_uuid?: string
          _complemento?: string
          _contato_nome?: string
          _documento?: string
          _email?: string
          _estado?: string
          _inscricao_estadual?: string
          _logradouro?: string
          _nome_fantasia?: string
          _numero?: string
          _observacoes?: string
          _razao_social: string
          _status?: Database["public"]["Enums"]["cadastro_status"]
          _telefone?: string
          _tipo: Database["public"]["Enums"]["pessoa_tipo"]
        }
        Returns: Json
      }
      criar_lancamento_avulso: {
        Args: {
          _categoria_id: string
          _client_uuid: string
          _cliente_id: string
          _data_emissao: string
          _data_vencimento: string
          _descricao: string
          _forma_pagamento: string
          _fornecedor_id: string
          _numero_documento: string
          _observacoes: string
          _tipo: string
          _valor: number
        }
        Returns: Json
      }
      criar_lote_produto: {
        Args: {
          _client_uuid?: string
          _custo_unitario?: number
          _data_fabricacao?: string
          _data_validade?: string
          _numero_lote: string
          _observacoes?: string
          _produto_id: string
          _quantidade_inicial?: number
          _registrar_entrada?: boolean
          _variacao_id?: string
        }
        Returns: Json
      }
      criar_produto: {
        Args: {
          _aceita_etiqueta_balanca?: boolean
          _casas_decimais_quantidade?: number
          _categoria_id?: string
          _client_uuid?: string
          _codigo_barras?: string
          _codigo_interno?: string
          _descricao?: string
          _estoque_inicial?: number
          _estoque_minimo: number
          _marca?: string
          _ncm?: string
          _nome: string
          _observacao_tecnica?: string
          _plu?: string
          _preco_custo: number
          _preco_venda: number
          _qr_code?: string
          _sku: string
          _status: Database["public"]["Enums"]["produto_status"]
          _tipo_identificacao_principal?: string
          _unidade: string
          _vendido_por_peso?: boolean
        }
        Returns: Json
      }
      criar_produto_variacao: {
        Args: {
          _atributos?: Json
          _client_uuid?: string
          _codigo_barras?: string
          _nome: string
          _preco_custo?: number
          _preco_venda?: number
          _produto_id: string
          _sku: string
        }
        Returns: Json
      }
      current_empresa_id: { Args: never; Returns: string }
      derivar_status_pagamento_venda: {
        Args: { _venda_id: string }
        Returns: string
      }
      editar_categoria_financeira: {
        Args: {
          _categoria_id: string
          _cor?: string
          _nome: string
          _parent_id?: string
        }
        Returns: Json
      }
      editar_categoria_produto: {
        Args: {
          _categoria_id: string
          _descricao?: string
          _nome: string
          _parent_id?: string
        }
        Returns: Json
      }
      editar_cliente: {
        Args: {
          _bairro?: string
          _celular?: string
          _cep?: string
          _cidade?: string
          _cliente_id: string
          _complemento?: string
          _data_nascimento?: string
          _documento?: string
          _email?: string
          _estado?: string
          _inscricao_estadual?: string
          _logradouro?: string
          _nome: string
          _nome_fantasia?: string
          _numero?: string
          _observacoes?: string
          _status?: Database["public"]["Enums"]["cadastro_status"]
          _telefone?: string
          _tipo: Database["public"]["Enums"]["pessoa_tipo"]
        }
        Returns: Json
      }
      editar_fornecedor: {
        Args: {
          _bairro?: string
          _cep?: string
          _cidade?: string
          _complemento?: string
          _contato_nome?: string
          _documento?: string
          _email?: string
          _estado?: string
          _fornecedor_id: string
          _inscricao_estadual?: string
          _logradouro?: string
          _nome_fantasia?: string
          _numero?: string
          _observacoes?: string
          _razao_social: string
          _status?: Database["public"]["Enums"]["cadastro_status"]
          _telefone?: string
          _tipo: Database["public"]["Enums"]["pessoa_tipo"]
        }
        Returns: Json
      }
      editar_lancamento_avulso: {
        Args: {
          _categoria_id: string
          _client_uuid: string
          _cliente_id: string
          _data_emissao: string
          _data_vencimento: string
          _descricao: string
          _forma_pagamento: string
          _fornecedor_id: string
          _lancamento_id: string
          _numero_documento: string
          _observacoes: string
          _valor: number
        }
        Returns: Json
      }
      editar_lote_produto: {
        Args: {
          _custo_unitario?: number
          _data_fabricacao?: string
          _data_validade?: string
          _lote_id: string
          _numero_lote: string
          _observacoes?: string
          _quantidade_inicial?: number
          _variacao_id?: string
        }
        Returns: Json
      }
      editar_produto: {
        Args: {
          _aceita_etiqueta_balanca?: boolean
          _casas_decimais_quantidade?: number
          _categoria_id?: string
          _codigo_barras?: string
          _codigo_interno?: string
          _descricao?: string
          _estoque_inicial?: number
          _estoque_minimo: number
          _marca?: string
          _ncm?: string
          _nome: string
          _observacao_tecnica?: string
          _plu?: string
          _preco_custo: number
          _preco_venda: number
          _produto_id: string
          _qr_code?: string
          _sku: string
          _status: Database["public"]["Enums"]["produto_status"]
          _tipo_identificacao_principal?: string
          _unidade: string
          _vendido_por_peso?: boolean
        }
        Returns: Json
      }
      excluir_caixa: { Args: { _caixa_id: string }; Returns: Json }
      excluir_categoria_financeira: {
        Args: { _categoria_id: string }
        Returns: Json
      }
      excluir_categoria_produto: {
        Args: { _categoria_id: string }
        Returns: Json
      }
      excluir_cliente: { Args: { _cliente_id: string }; Returns: Json }
      excluir_compra: { Args: { _compra_id: string }; Returns: undefined }
      excluir_fornecedor: { Args: { _fornecedor_id: string }; Returns: Json }
      excluir_lancamento_avulso: {
        Args: { _lancamento_id: string }
        Returns: Json
      }
      excluir_lote_produto: { Args: { _lote_id: string }; Returns: Json }
      excluir_produto: { Args: { _produto_id: string }; Returns: Json }
      excluir_produto_codigo: { Args: { _codigo_id: string }; Returns: Json }
      excluir_produto_variacao: {
        Args: { _variacao_id: string }
        Returns: Json
      }
      excluir_venda_cancelada: { Args: { _venda_id: string }; Returns: Json }
      fechar_caixa: {
        Args: {
          _caixa_id: string
          _observacao?: string
          _valor_informado: number
        }
        Returns: Json
      }
      finalizar_venda_pdv:
        | {
            Args: {
              _cliente_id: string
              _desconto: number
              _forma: Database["public"]["Enums"]["forma_pagamento"]
              _gerar_financeiro?: boolean
              _itens: Json
              _observacao: string
              _status_pagamento: string
              _subtotal: number
              _total: number
              _troco: number
              _valor_recebido: number
            }
            Returns: string
          }
        | {
            Args: {
              _cliente_id: string
              _desconto: number
              _forma: Database["public"]["Enums"]["forma_pagamento"]
              _gerar_financeiro?: boolean
              _itens: Json
              _observacao: string
              _pagamentos?: Json
              _status_pagamento: string
              _subtotal: number
              _total: number
              _troco: number
              _valor_recebido: number
            }
            Returns: string
          }
        | {
            Args: {
              _cliente_id: string
              _desconto: number
              _forma: Database["public"]["Enums"]["forma_pagamento"]
              _gerar_financeiro?: boolean
              _itens: Json
              _observacao: string
              _operador_id?: string
              _pagamentos?: Json
              _status_pagamento: string
              _subtotal: number
              _total: number
              _troco: number
              _valor_recebido: number
            }
            Returns: string
          }
        | {
            Args: {
              _cliente_id: string
              _desconto: number
              _forma: Database["public"]["Enums"]["forma_pagamento"]
              _gerar_financeiro?: boolean
              _itens: Json
              _observacao: string
              _operador_id?: string
              _pagamentos?: Json
              _status_pagamento: string
              _subtotal: number
              _terminal_id?: string
              _total: number
              _troco: number
              _valor_recebido: number
            }
            Returns: string
          }
        | {
            Args: {
              _client_uuid?: string
              _cliente_id: string
              _data_vencimento?: string
              _desconto: number
              _forma: Database["public"]["Enums"]["forma_pagamento"]
              _gerar_financeiro?: boolean
              _itens: Json
              _observacao: string
              _operador_id?: string
              _pagamentos?: Json
              _status_pagamento: string
              _subtotal: number
              _terminal_id?: string
              _total: number
              _troco: number
              _valor_recebido: number
            }
            Returns: string
          }
      fornecedor_metricas: {
        Args: never
        Returns: {
          compras_em_aberto: number
          fornecedor_id: string
          total_compras: number
          ultima_compra: string
          valor_total: number
        }[]
      }
      funcionario_alterar_status: {
        Args: { _ativo: boolean; _funcionario_id: string }
        Returns: Json
      }
      funcionario_criar:
        | {
            Args: {
              _login: string
              _nome: string
              _pin: string
              _role?: Database["public"]["Enums"]["app_role"]
            }
            Returns: string
          }
        | {
            Args: {
              _client_uuid?: string
              _login: string
              _nome: string
              _pin: string
              _role?: Database["public"]["Enums"]["app_role"]
            }
            Returns: Json
          }
      funcionario_desbloquear_pin: {
        Args: { _funcionario_id: string }
        Returns: Json
      }
      funcionario_editar: {
        Args: {
          _funcionario_id: string
          _login: string
          _nome: string
          _role: Database["public"]["Enums"]["app_role"]
        }
        Returns: Json
      }
      funcionario_excluir: { Args: { _funcionario_id: string }; Returns: Json }
      funcionario_resetar_pin: {
        Args: { _funcionario_id: string; _novo_pin: string }
        Returns: undefined
      }
      funcionario_validar_pin: {
        Args: {
          _funcionario_id: string
          _ip_address?: string
          _pin: string
          _terminal_id?: string
          _user_agent?: string
        }
        Returns: Json
      }
      funcionarios_listar: {
        Args: never
        Returns: {
          ativo: boolean
          created_at: string
          id: string
          login: string
          nome: string
          role: Database["public"]["Enums"]["app_role"]
          ultimo_acesso: string
        }[]
      }
      garantir_empresa_atual: { Args: { _nome?: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_member_of: {
        Args: { _empresa_id: string; _user_id: string }
        Returns: boolean
      }
      is_super_admin: { Args: { _user_id?: string }; Returns: boolean }
      listar_membros_empresa: {
        Args: { _empresa_id: string }
        Returns: {
          created_at: string
          email: string
          id: string
          papel: Database["public"]["Enums"]["empresa_papel"]
          user_id: string
        }[]
      }
      marcar_assinaturas_overdue_expired: { Args: never; Returns: Json }
      meus_modulos: {
        Args: never
        Returns: {
          aplica_restricao: boolean
          chave: string
          descricao: string
          liberado: boolean
          modulo_id: string
          nome: string
          origem: string
          valor: number
        }[]
      }
      minha_assinatura_status: { Args: never; Returns: Json }
      minhas_empresas_ids: { Args: { _user_id: string }; Returns: string[] }
      modos_disponiveis: {
        Args: never
        Returns: {
          chave: string
          descricao: string
          icone: string
          id: string
          nome: string
          rota_inicial: string
          tipo: Database["public"]["Enums"]["system_mode_tipo"]
        }[]
      }
      modulos_disponiveis_cliente: {
        Args: never
        Returns: {
          aplica_restricao: boolean
          chave: string
          data_expiracao: string
          descricao: string
          id: string
          nome: string
          status: string
          valor: number
        }[]
      }
      papel_na_empresa: {
        Args: { _empresa_id: string; _user_id: string }
        Returns: Database["public"]["Enums"]["empresa_papel"]
      }
      planos_disponiveis: {
        Args: never
        Returns: {
          atual: boolean
          descricao: string
          id: string
          limite_produtos: number
          limite_usuarios: number
          nome: string
          ordem: number
          tipo_cobranca: Database["public"]["Enums"]["plano_tipo_cobranca"]
          valor: number
        }[]
      }
      pode_ver_financeiro: {
        Args: { _empresa_id: string; _user_id: string }
        Returns: boolean
      }
      reabrir_caixa: {
        Args: { _caixa_id: string; _motivo?: string }
        Returns: Json
      }
      reabrir_lancamento: { Args: { _lancamento_id: string }; Returns: Json }
      receber_compra: {
        Args: {
          _categoria_id?: string
          _compra_id: string
          _data_recebimento?: string
          _data_vencimento?: string
          _gerar_financeiro?: boolean
        }
        Returns: string
      }
      receber_compra_itens: {
        Args: {
          _categoria_id?: string
          _compra_id: string
          _data_recebimento?: string
          _data_vencimento?: string
          _gerar_financeiro?: boolean
          _itens: Json
        }
        Returns: Json
      }
      registrar_audit_log: {
        Args: {
          _action: string
          _metadata?: Json
          _target_id?: string
          _target_type?: string
        }
        Returns: undefined
      }
      registrar_movimento_estoque: {
        Args: {
          _client_uuid: string
          _custo_unitario: number
          _observacoes: string
          _origem: string
          _produto_id: string
          _quantidade: number
          _tipo: string
          _variacao_id: string
        }
        Returns: Json
      }
      registrar_pagamento_lancamento: {
        Args: {
          _client_uuid?: string
          _data_pagamento: string
          _forma_pagamento?: Database["public"]["Enums"]["forma_pagamento"]
          _lancamento_id: string
          _observacao?: string
          _valor: number
        }
        Returns: Json
      }
      remover_membro: { Args: { _membro_id: string }; Returns: Json }
      remover_pagamento_lancamento: {
        Args: { _pagamento_id: string }
        Returns: Json
      }
      resetar_dados_empresa: { Args: never; Returns: undefined }
      saldos_estoque_lote: {
        Args: { _produto_ids: string[] }
        Returns: {
          produto_id: string
          saldo: number
        }[]
      }
      sincronizar_lancamento_compra: {
        Args: { _compra_id: string }
        Returns: string
      }
      solicitar_carrinho: {
        Args: { _modulos?: string[]; _planos?: string[] }
        Returns: string
      }
      solicitar_contratacao_modulo: {
        Args: { _modulo_id: string }
        Returns: string
      }
      solicitar_contratacao_plano: {
        Args: { _plano_id: string }
        Returns: string
      }
      terminais_listar: {
        Args: never
        Returns: {
          ativo: boolean
          caixa_aberto_id: string
          created_at: string
          descricao: string
          heartbeat_at: string
          id: string
          identificador_dispositivo: string
          ip_local: string
          nome: string
          operador_atual_id: string
          operador_atual_nome: string
          papel: string
          pareamento_token: string
          ultimo_uso: string
          user_agent: string
        }[]
      }
      terminal_atualizar_permissoes: {
        Args: {
          _pode_cadastros: boolean
          _pode_configuracoes: boolean
          _pode_erp: boolean
          _pode_financeiro: boolean
          _pode_pdv: boolean
          _pode_relatorios: boolean
          _terminal_id: string
        }
        Returns: undefined
      }
      terminal_definir_servidor: {
        Args: { _terminal_id: string }
        Returns: undefined
      }
      terminal_gerar_token: { Args: { _terminal_id: string }; Returns: string }
      terminal_heartbeat: {
        Args: {
          _ip_local?: string
          _operador_id?: string
          _operador_nome?: string
          _terminal_id: string
          _user_agent?: string
        }
        Returns: undefined
      }
      terminal_limpar_operador: {
        Args: { _terminal_id: string }
        Returns: undefined
      }
      terminal_ping: { Args: never; Returns: string }
      terminal_resolver: {
        Args: { _identificador?: string; _token?: string }
        Returns: {
          ativo: boolean
          id: string
          nome: string
        }[]
      }
      venda_metricas_periodo: {
        Args: { _data_fim?: string; _data_inicio?: string }
        Returns: Json
      }
    }
    Enums: {
      app_role:
        | "admin"
        | "gerente"
        | "vendedor"
        | "financeiro"
        | "super_admin"
        | "caixa"
      assinatura_status:
        | "trial"
        | "ativo"
        | "vencido"
        | "cancelado"
        | "active"
        | "pending_payment"
        | "overdue"
        | "expired"
        | "canceled"
      autorizacao_acao:
        | "fechar_caixa_divergencia"
        | "fechar_caixa_qualquer"
        | "remover_item_venda"
        | "cancelar_venda"
        | "cancelar_compra"
        | "excluir_lancamento_financeiro"
        | "alterar_valor_confirmado"
        | "reabrir_caixa"
        | "sangria_caixa"
        | "suprimento_caixa"
      autorizacao_metodo: "pin_funcionario" | "senha_master" | "codigo_qr"
      autorizacao_status: "autorizado" | "negado"
      cadastro_status: "ativo" | "inativo"
      caixa_movimento_tipo:
        | "abertura"
        | "venda"
        | "sangria"
        | "suprimento"
        | "fechamento"
      caixa_status: "aberto" | "fechado"
      categoria_financeira_tipo: "receita" | "despesa"
      cobranca_wa_status: "pending" | "sent" | "failed" | "manual"
      cobranca_wa_tipo:
        | "antes_vencimento"
        | "vencimento"
        | "apos_vencimento"
        | "manual"
      compra_status:
        | "rascunho"
        | "pendente"
        | "aprovada"
        | "recebida_parcial"
        | "recebida"
        | "cancelada"
      empresa_modulo_status: "ativo" | "pendente" | "cancelado"
      empresa_papel: "owner" | "admin" | "gerente_operacional"
      forma_pagamento:
        | "dinheiro"
        | "pix"
        | "cartao_credito"
        | "cartao_debito"
        | "boleto"
        | "transferencia"
        | "cheque"
        | "outro"
        | "ifood"
        | "fiado"
      integracao_status:
        | "disconnected"
        | "configuring"
        | "connected"
        | "error"
        | "disabled"
      integracao_tipo: "ifood" | "mercado_livre" | "shopee" | "whatsapp" | "pix"
      lancamento_status:
        | "pendente"
        | "pago"
        | "recebido"
        | "vencido"
        | "cancelado"
        | "parcial"
      lancamento_tipo: "receita" | "despesa" | "receber" | "pagar"
      movimentacao_origem:
        | "compra"
        | "venda"
        | "ajuste_manual"
        | "devolucao_cliente"
        | "devolucao_fornecedor"
        | "inventario"
        | "outro"
      movimentacao_tipo:
        | "entrada"
        | "saida"
        | "ajuste"
        | "devolucao"
        | "transferencia"
      pagamento_referencia: "plano" | "modulo" | "outro"
      pagamento_status: "pago" | "pendente" | "atrasado" | "cancelado"
      pedido_externo_origem: "ifood" | "mercado_livre" | "shopee"
      pessoa_tipo: "PF" | "PJ"
      plano_tipo_cobranca: "mensal" | "anual" | "vitalicio"
      produto_status: "ativo" | "inativo" | "descontinuado"
      qa_severidade: "critico" | "medio" | "leve"
      qa_status_avaliacao: "nao_testado" | "ok" | "leve" | "medio" | "critico"
      qa_validacao_status: "em_andamento" | "finalizada"
      system_mode_tipo: "admin" | "operador"
      venda_status:
        | "rascunho"
        | "pendente"
        | "aprovada"
        | "faturada"
        | "entregue"
        | "cancelada"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "admin",
        "gerente",
        "vendedor",
        "financeiro",
        "super_admin",
        "caixa",
      ],
      assinatura_status: [
        "trial",
        "ativo",
        "vencido",
        "cancelado",
        "active",
        "pending_payment",
        "overdue",
        "expired",
        "canceled",
      ],
      autorizacao_acao: [
        "fechar_caixa_divergencia",
        "fechar_caixa_qualquer",
        "remover_item_venda",
        "cancelar_venda",
        "cancelar_compra",
        "excluir_lancamento_financeiro",
        "alterar_valor_confirmado",
        "reabrir_caixa",
        "sangria_caixa",
        "suprimento_caixa",
      ],
      autorizacao_metodo: ["pin_funcionario", "senha_master", "codigo_qr"],
      autorizacao_status: ["autorizado", "negado"],
      cadastro_status: ["ativo", "inativo"],
      caixa_movimento_tipo: [
        "abertura",
        "venda",
        "sangria",
        "suprimento",
        "fechamento",
      ],
      caixa_status: ["aberto", "fechado"],
      categoria_financeira_tipo: ["receita", "despesa"],
      cobranca_wa_status: ["pending", "sent", "failed", "manual"],
      cobranca_wa_tipo: [
        "antes_vencimento",
        "vencimento",
        "apos_vencimento",
        "manual",
      ],
      compra_status: [
        "rascunho",
        "pendente",
        "aprovada",
        "recebida_parcial",
        "recebida",
        "cancelada",
      ],
      empresa_modulo_status: ["ativo", "pendente", "cancelado"],
      empresa_papel: ["owner", "admin", "gerente_operacional"],
      forma_pagamento: [
        "dinheiro",
        "pix",
        "cartao_credito",
        "cartao_debito",
        "boleto",
        "transferencia",
        "cheque",
        "outro",
        "ifood",
        "fiado",
      ],
      integracao_status: [
        "disconnected",
        "configuring",
        "connected",
        "error",
        "disabled",
      ],
      integracao_tipo: ["ifood", "mercado_livre", "shopee", "whatsapp", "pix"],
      lancamento_status: [
        "pendente",
        "pago",
        "recebido",
        "vencido",
        "cancelado",
        "parcial",
      ],
      lancamento_tipo: ["receita", "despesa", "receber", "pagar"],
      movimentacao_origem: [
        "compra",
        "venda",
        "ajuste_manual",
        "devolucao_cliente",
        "devolucao_fornecedor",
        "inventario",
        "outro",
      ],
      movimentacao_tipo: [
        "entrada",
        "saida",
        "ajuste",
        "devolucao",
        "transferencia",
      ],
      pagamento_referencia: ["plano", "modulo", "outro"],
      pagamento_status: ["pago", "pendente", "atrasado", "cancelado"],
      pedido_externo_origem: ["ifood", "mercado_livre", "shopee"],
      pessoa_tipo: ["PF", "PJ"],
      plano_tipo_cobranca: ["mensal", "anual", "vitalicio"],
      produto_status: ["ativo", "inativo", "descontinuado"],
      qa_severidade: ["critico", "medio", "leve"],
      qa_status_avaliacao: ["nao_testado", "ok", "leve", "medio", "critico"],
      qa_validacao_status: ["em_andamento", "finalizada"],
      system_mode_tipo: ["admin", "operador"],
      venda_status: [
        "rascunho",
        "pendente",
        "aprovada",
        "faturada",
        "entregue",
        "cancelada",
      ],
    },
  },
} as const
