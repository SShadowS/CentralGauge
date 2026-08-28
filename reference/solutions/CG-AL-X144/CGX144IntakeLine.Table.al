table 71203 "CG X144 Intake Line"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Document No."; Code[20]) { DataClassification = CustomerContent; }
        field(2; "Line No."; Integer) { DataClassification = CustomerContent; }
        field(3; "Item No."; Code[20]) { DataClassification = CustomerContent; }
        field(4; Quantity; Decimal) { DataClassification = CustomerContent; }
        field(5; "Unit Cost"; Decimal) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "Document No.", "Line No.") { Clustered = true; }
    }
}
