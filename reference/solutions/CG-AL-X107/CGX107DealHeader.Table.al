table 70670 "CG X107 Deal Header"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20]) { DataClassification = CustomerContent; }
        field(2; "Deal Reference"; Text[30]) { DataClassification = CustomerContent; }
        field(3; Amount; Decimal) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "No.") { Clustered = true; }
    }
}
