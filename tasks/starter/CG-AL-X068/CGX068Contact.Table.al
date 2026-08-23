table 70330 "CG X068 Contact"
{
    DataClassification = CustomerContent;

    fields
    {
        field(1; "No."; Code[20])
        {
            DataClassification = CustomerContent;
        }
        field(2; Name; Text[100])
        {
            DataClassification = CustomerContent;
        }
        field(3; City; Text[50])
        {
            DataClassification = CustomerContent;
        }
        field(4; Email; Text[80])
        {
            DataClassification = CustomerContent;
        }
    }

    keys
    {
        key(PK; "No.")
        {
            Clustered = true;
        }
    }
}
