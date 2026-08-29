table 71420 "CG X158 Item"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20]) { }
        field(2; Description; Text[100]) { }
        field(3; "Base Qty per Sales Unit"; Decimal) { InitValue = 1; }
        field(4; "Qty on Hand (Base)"; Decimal) { }
    }

    keys
    {
        key(PK; "No.")
        {
            Clustered = true;
        }
    }

    procedure ToBaseQty(SalesQty: Decimal): Decimal
    begin
        exit(SalesQty * "Base Qty per Sales Unit");
    end;
}
