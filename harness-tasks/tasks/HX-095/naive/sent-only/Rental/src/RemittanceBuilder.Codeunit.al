codeunit 70266 "CGR Remittance Builder"
{
    // Month-end remittance: brings the amounts of the payment export lines of a contract up to
    // date. Sent lines keep the amounts the partner confirmed.
    procedure Rebuild(ContractNo: Code[20])
    var
        ExportLine: Record "CGR Payment Export Line";
        PaymentEntry: Record "CGR Customer Payment Entry";
        ExchangeRate: Record "CGR Exchange Rate";
        Factor: Decimal;
    begin
        ExportLine.SetRange("Contract No.", ContractNo);
        ExportLine.SetFilter(Status, '<>%1', ExportLine.Status::Sent);
        if ExportLine.FindSet(true) then
            repeat
                PaymentEntry.Reset();
                PaymentEntry.SetRange("Contract No.", ExportLine."Contract No.");
                PaymentEntry.SetRange("Applies-to ID", ExportLine."Applies-to ID");
                PaymentEntry.CalcSums("Remaining Amount");
                ExportLine.Amount := PaymentEntry."Remaining Amount";

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
