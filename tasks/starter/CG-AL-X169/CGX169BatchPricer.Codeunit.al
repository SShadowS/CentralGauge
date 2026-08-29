codeunit 71535 "CG X169 Batch Pricer"
{
    procedure PriceBatch(BatchNo: Code[20]; var PricedLine: Record "CG X169 Priced Line" temporary)
    var
        BatchLine: Record "CG X169 Batch Line";
        Setup: Record "CG X169 Pricing Setup";
        Item: Record "CG X169 Item";
        PriceRule: Record "CG X169 Price Rule";
        MarkupPct: Decimal;
        UnitPrice: Decimal;
    begin
        PricedLine.SetRange("Batch No.", BatchNo);
        PricedLine.DeleteAll();

        BatchLine.SetRange("Batch No.", BatchNo);
        if BatchLine.FindSet() then
            repeat
                Setup.Get('SETUP');

                MarkupPct := 0;
                if Item.Get(BatchLine."Item No.") then begin
                    PriceRule.SetRange("Price Group", Item."Price Group");
                    if PriceRule.FindFirst() then
                        MarkupPct := PriceRule."Markup Pct";

                    UnitPrice := Round(Item."Unit Cost" * (1 + (Setup."Base Margin Pct" + MarkupPct) / 100), Setup."Rounding Precision");

                    PricedLine.Init();
                    PricedLine."Batch No." := BatchLine."Batch No.";
                    PricedLine."Line No." := BatchLine."Line No.";
                    PricedLine."Unit Price" := UnitPrice;
                    PricedLine."Line Amount" := UnitPrice * BatchLine.Quantity;
                    PricedLine.Insert();
                end;
            until BatchLine.Next() = 0;
    end;
}
