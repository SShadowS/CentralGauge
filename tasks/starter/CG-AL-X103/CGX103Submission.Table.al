table 70630 "CG X103 Submission"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20]) { DataClassification = CustomerContent; }
        field(2; "Contact E-Mail"; Text[80]) { DataClassification = CustomerContent; }
        field(3; "Notify E-Mail"; Text[80]) { DataClassification = CustomerContent; }
        field(4; "Setup Code"; Code[10]) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "No.") { Clustered = true; }
    }
}
