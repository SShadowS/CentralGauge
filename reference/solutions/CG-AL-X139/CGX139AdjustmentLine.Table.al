table 70991 "CG X139 Adjustment Line"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Document No."; Code[20]) { }
        field(2; "Line No."; Integer) { }
        field(3; "Adjustment Type"; Enum "CG X139 Adjustment Type") { }
        field(4; "Item No."; Code[20]) { }
        field(5; "Location Code"; Code[10]) { }
        field(6; "New Location Code"; Code[10]) { }
        field(7; Quantity; Decimal) { }
    }

    keys
    {
        key(PK; "Document No.", "Line No.")
        {
            Clustered = true;
        }
    }
}
