table 70980 "CG X138 Doc Index"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Match Key"; Code[20]) { DataClassification = CustomerContent; }
        field(2; "Doc No."; Code[20]) { DataClassification = CustomerContent; }
    }

    keys
    {
        key(PK; "Match Key") { Clustered = true; }
    }
}
