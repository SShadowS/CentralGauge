table 71571 "CG X173 Vendor"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20]) { DataClassification = CustomerContent; }
        field(2; Name; Text[100]) { DataClassification = CustomerContent; }
        field(3; "Terms Code"; Code[10]) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "No.") { Clustered = true; }
    }
}
