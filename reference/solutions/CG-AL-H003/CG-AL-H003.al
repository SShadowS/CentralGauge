table 70203 "CG Discount Result"
{
    Caption = 'CG Discount Result';
    DataClassification = CustomerContent;
    TableType = Temporary;

    fields
    {
        field(1; "Line No."; Integer)
        {
            Caption = 'Line No.';
        }
        field(2; "Item No."; Code[20])
        {
            Caption = 'Item No.';
        }
        field(3; "Original Price"; Decimal)
        {
            Caption = 'Original Price';
        }
        field(4; "Discount Percent"; Decimal)
        {
            Caption = 'Discount Percent';
        }
        field(5; "Final Price"; Decimal)
        {
            Caption = 'Final Price';
        }
    }

    keys
    {
        key(PK; "Line No.")
        {
            Clustered = true;
        }
    }
}

codeunit 70202 "CG Temp Table Processor"
{
    Access = Public;

    procedure ProcessItemsWithDiscount(var TempResult: Record "CG Discount Result" temporary; MinDiscount: Decimal)
    var
        Item: Record Item;
        DiscountPct: Decimal;
        LineNo: Integer;
    begin
        TempResult.Reset();
        TempResult.DeleteAll();

        LineNo := 0;

        if Item.FindSet() then
            repeat
                if Item."Unit Price" > 0 then begin
                    Item.CalcFields(Inventory);

                    if Item.Inventory >= 100 then
                        DiscountPct := 15
                    else
                        if Item.Inventory >= 50 then
                            DiscountPct := 10
                        else
                            if Item.Inventory >= 10 then
                                DiscountPct := 5
                            else
                                DiscountPct := 0;

                    if DiscountPct >= MinDiscount then begin
                        LineNo += 10000;
                        TempResult.Init();
                        TempResult."Line No." := LineNo;
                        TempResult."Item No." := Item."No.";
                        TempResult."Original Price" := Item."Unit Price";
                        TempResult."Discount Percent" := DiscountPct;
                        TempResult."Final Price" := Round(Item."Unit Price" * (1 - DiscountPct / 100), 0.01);
                        TempResult.Insert();
                    end;
                end;
            until Item.Next() = 0;
    end;
}