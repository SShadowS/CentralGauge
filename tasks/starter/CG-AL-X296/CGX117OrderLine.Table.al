table 70771 "CG X117 Order Line"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Document No."; Code[20]) { DataClassification = CustomerContent; }
        field(2; "Line No."; Integer) { DataClassification = CustomerContent; }
        field(3; "No."; Code[20]) { DataClassification = CustomerContent; }
        field(4; Description; Text[100]) { DataClassification = CustomerContent; }
        field(5; Quantity; Decimal) { DataClassification = CustomerContent; }
        field(6; "Unit Price"; Decimal) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "Document No.", "Line No.") { Clustered = true; }
    }
}
