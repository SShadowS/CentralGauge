table 70952 "CG X135 Posted Order"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20]) { DataClassification = CustomerContent; }
        field(2; Amount; Decimal) { DataClassification = CustomerContent; }
        field(3; "Posted On"; Date) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "No.") { Clustered = true; }
    }
}
