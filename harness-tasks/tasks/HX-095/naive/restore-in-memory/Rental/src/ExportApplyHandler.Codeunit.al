codeunit 70265 "CGR Export Apply Handler"
{
    // Carries a new payment application over to the contract's payment export lines. The amounts
    // of Exported and Sent lines are put back after the recalculation.
    [EventSubscriber(ObjectType::Codeunit, Codeunit::"CGR Payment Application", 'OnAfterApplyEntries', '', false, false)]
    local procedure HandleApplyEntries(ContractNo: Code[20]; AppliesToId: Code[20])
    var
        ExportLine: Record "CGR Payment Export Line";
        PaymentEntry: Record "CGR Customer Payment Entry";
        ExchangeRate: Record "CGR Exchange Rate";
        OldAmount: Decimal;
        OldAmountLCY: Decimal;
        Factor: Decimal;
    begin
        ExportLine.SetRange("Contract No.", ContractNo);
        if ExportLine.FindSet(true) then
            repeat
                OldAmount := ExportLine.Amount;
                OldAmountLCY := ExportLine."Amount (LCY)";
                ExportLine."Applies-to ID" := AppliesToId;

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

                if ExportLine.Status in [ExportLine.Status::Exported, ExportLine.Status::Sent] then begin
                    ExportLine.Amount := OldAmount;
                    ExportLine."Amount (LCY)" := OldAmountLCY;
                end;
            until ExportLine.Next() = 0;
    end;
}
