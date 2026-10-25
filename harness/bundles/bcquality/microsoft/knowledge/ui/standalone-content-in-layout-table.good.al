page 50208 "UI Sample Standalone Content"
{
    PageType = Card;
    SourceTable = Customer;

    layout
    {
        area(Content)
        {
            grid(InfoGrid)
            {
                GridLayout = Columns;
                group(LeftColumn)
                {
                    field(Address; Rec.Address)
                    {
                        ApplicationArea = All;
                    }
                    field(City; Rec.City)
                    {
                        ApplicationArea = All;
                    }
                }
                group(RightColumn)
                {
                    field(StatusMessage; StatusText)
                    {
                        ApplicationArea = All;
                        Editable = false;
                        ShowCaption = false;
                    }
                }
            }
        }
    }

    var
        StatusText: Text;
}
