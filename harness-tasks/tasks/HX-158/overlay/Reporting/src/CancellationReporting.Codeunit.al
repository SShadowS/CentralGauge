codeunit 70534 "CGR Cancellation Reporting"
{
    procedure BranchTotals(BranchCode: Code[10]; var FeeTotal: Decimal; var Cancellations: Integer)
    var
        Totals: Query "CGR Branch Cancellations";
    begin
        FeeTotal := 0;
        Cancellations := 0;
        Totals.SetRange(BranchCode, BranchCode);
        Totals.Open();
        if Totals.Read() then begin
            FeeTotal := Totals.FeeTotal;
            Cancellations := Totals.Cancellations;
        end;
        Totals.Close();
    end;
}
