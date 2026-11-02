table 70011 "CGR Branch"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "Code"; Code[10]) { }
        field(2; Name; Text[100]) { }
        field(3; Harbour; Boolean) { }
    }

    keys
    {
        key(PK; "Code") { Clustered = true; }
    }
}
