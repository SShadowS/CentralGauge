codeunit 70264 "CGR Export Line Amount"
{
    // Works out a payment export line's amounts from the payment entries applied to it.
    // Used by the desk's "Refresh amounts" action. Exported and Sent lines keep their Amount.
    procedure UpdateAmount(var ExportLine: Record "CGR Payment Export Line")
    var
        PaymentEntry: Record "CGR Customer Payment Entry";
        ExchangeRate: Record "CGR Exchange Rate";
        Factor: Decimal;
    begin
        if not (ExportLine.Status in [ExportLine.Status::Exported, ExportLine.Status::Sent]) then begin
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
    end;
}
