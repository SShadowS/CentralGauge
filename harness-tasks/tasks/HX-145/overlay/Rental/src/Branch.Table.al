table 70294 "CGR Branch"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; Code; Code[10]) { NotBlank = true; }
        field(2; Name; Text[50]) { }
    }

    keys
    {
        key(PK; Code) { Clustered = true; }
    }
}
