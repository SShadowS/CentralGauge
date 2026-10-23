codeunit 70524 "CGR Lease Due Plan"
{
    procedure FillDuePlan(ContractFilter: Text; FromDate: Date; ToDate: Date; var PlanLine: Record "CGR Due Plan Line" temporary)
    var
        DueMonths: Query "CGR Lease Due Months";
    begin
        PlanLine.Reset();
        PlanLine.DeleteAll();
        DueMonths.SetFilter(ContractNo, ContractFilter);
        DueMonths.SetFilter(DueDateFilter, '%1..%2', FromDate, ToDate - 1);
        DueMonths.Open();
        while DueMonths.Read() do begin
            PlanLine.Init();
            PlanLine."Contract No." := DueMonths.ContractNo;
            PlanLine."Due Year" := DueMonths.DueYear;
            PlanLine."Due Month" := DueMonths.DueMonth;
            PlanLine.Amount := DueMonths.Amount;
            PlanLine.Lines := DueMonths.Lines;
            PlanLine.Insert();
        end;
        DueMonths.Close();
    end;
}
