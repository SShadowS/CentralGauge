table 70811 "CG X121 Contract Line"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Contract No."; Code[20]) { DataClassification = CustomerContent; }
        field(2; "Entry No."; Integer) { DataClassification = CustomerContent; }
        field(3; "Period No."; Integer) { DataClassification = CustomerContent; }
        field(4; Amount; Decimal) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "Contract No.", "Entry No.") { Clustered = true; }
    }
}
