table 71421 "CG X158 Order Line"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Order No."; Code[20]) { }
        field(2; "Line No."; Integer) { }
        field(3; "Item No."; Code[20]) { }
        field(4; Quantity; Decimal) { }
    }

    keys
    {
        key(PK; "Order No.", "Line No.")
        {
            Clustered = true;
        }
    }
}
