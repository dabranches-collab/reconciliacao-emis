begin;

select set_config(
  'request.jwt.claim.sub',
  (select id::text from public.profiles where email='dabranches@gmail.com'),
  true
);

do $$
declare
  v_user uuid:=auth.uid();
  v_series uuid;
  v_import uuid;
  v_result jsonb;
  v_metrics jsonb;
begin
  if v_user is null then raise exception 'Utilizador de teste não encontrado.'; end if;
  insert into public.rt_v2_series(created_by) values(v_user) returning id into v_series;
  insert into public.rt_v2_imports(series_id,original_filename,file_sha256,file_size,state,uploaded_by)
  values(v_series,'smoke-test.xlsx',repeat('a',64),1024,'reconciling',v_user) returning id into v_import;
  insert into public.rt_v2_movements(series_id,import_id,source_row,fingerprint,raw_amount,accounting_date,account,amount,currency,operation_number,description_normalized,balance,native_idtr,status)
  values
    (v_series,v_import,2,'smoke-1','100','2026-07-10','2521247',100,'AOA','OP1','transferencia',1100,'IDTR=02863800046789','open'),
    (v_series,v_import,3,'smoke-2','-100','2026-07-13','2521247',-100,'AOA','OP2','transferencia',1000,'IDTR=02863800046789','open');
  select public.finalize_rt_v2_import(v_import) into v_result;
  select result into v_metrics from public.rt_v2_calculations where series_id=v_series and metric='dashboard';
  if v_result->>'status'<>'completed' then raise exception 'Finalizador não concluiu: %',v_result; end if;
  if (v_metrics#>>'{totals,reconciled}')::integer<>2 then raise exception 'Total reconciliado incorreto: %',v_metrics; end if;
  if (v_metrics#>>'{reconciledByDelay,D+1}')::integer<>1 then raise exception 'Sexta para segunda não foi classificada em D+1: %',v_metrics; end if;
end;
$$;

rollback;
