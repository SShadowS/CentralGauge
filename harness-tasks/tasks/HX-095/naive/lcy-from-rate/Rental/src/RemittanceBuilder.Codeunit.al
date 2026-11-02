codeunit 70266 "CGR Remittance Builder"
{
    // Month-end remittance: brings the amounts of every payment export line of a contract up to
    // date. Exported and Sent lines keep their Amount.
    procedure Rebuild(ContractNo: Code[20])
    var
        ExportLine: Record "CGR Payment Export Line";
        PaymentEntry: Record "CGR Customer Payment Entry";
        ExchangeRate: Record "CGR Exchange Rate";
        Factor: Decimal;
    begin
        ExportLine.SetRange("Contract No.", ContractNo);
        if ExportLine.FindSet(true) then
            repeat
                if not (ExportLine.Status in [ExportLine.Status::Exported, ExportLine.Status::Sent]) then begin
                    PaymentEntry.Reset();
                    PaymentEntry.SetRange("Contract No.", ExportLine."Contract No.");
                    PaymentEntry.SetRange("Applies-to ID", ExportLine."Applies-to ID");
                    PaymentEntry.CalcSums("Remaining Amount");
                    ExportLine.Amount := PaymentEntry."Remaining Amount";
                end;

                Factor := 1;
                if ExportLine."Currency Code" <> '' then
                    if ExchangeRate.Get(ExportLine."Currency Code") then
                        if ExchangeRate."Currency Factor" <> 0 then
                            Factor := ExchangeRate."Currency Factor";
                ExportLine."Amount (LCY)" := Round(ExportLine.Amount / Factor, 0.01);
                ExportLine.Modify();
            until ExportLine.Next() = 0;
    end;
}
