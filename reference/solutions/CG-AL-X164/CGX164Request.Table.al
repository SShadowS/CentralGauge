table 71480 "CG X164 Request"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20]) { DataClassification = CustomerContent; }
        field(2; Description; Text[100]) { DataClassification = CustomerContent; }
        field(3; Amount; Decimal) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "No.") { Clustered = true; }
    }
}
