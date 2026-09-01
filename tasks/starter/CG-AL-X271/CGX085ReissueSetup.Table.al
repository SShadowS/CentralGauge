table 70501 "CG X085 Reissue Setup"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Primary Key"; Code[10]) { DataClassification = CustomerContent; }
        field(2; "Default Batch Template"; Code[20]) { DataClassification = CustomerContent; }
        field(3; "Default Description"; Text[100]) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "Primary Key") { Clustered = true; }
    }
}
