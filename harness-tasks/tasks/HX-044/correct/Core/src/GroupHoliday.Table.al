table 70014 "CGR Group Holiday"
{
    DataClassification = CustomerContent;
    DataPerCompany = false;

    fields
    {
        field(1; "Holiday Date"; Date) { }
        field(2; Description; Text[100]) { }
    }

    keys
    {
        key(PK; "Holiday Date") { Clustered = true; }
    }
}
