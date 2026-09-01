table 70631 "CG X103 Notify Setup"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Code"; Code[10]) { DataClassification = CustomerContent; }
        field(2; "Fallback E-Mail"; Text[80]) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "Code") { Clustered = true; }
    }
}
