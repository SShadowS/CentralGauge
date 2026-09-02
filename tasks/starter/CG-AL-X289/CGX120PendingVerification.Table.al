table 70801 "CG X120 Pending Verification"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Record No."; Code[20]) { DataClassification = CustomerContent; }
        field(2; "Field Name"; Text[50]) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "Record No.", "Field Name") { Clustered = true; }
    }
}
