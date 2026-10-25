page 50207 "UI Sample Data Table"
{
    PageType = Card;
    SourceTable = Customer;

    layout
    {
        area(Content)
        {
            grid(DataGrid)
            {
                GridLayout = Columns;
                group(Column1)
                {
                    ShowCaption = false;
                    field(Name; Rec.Name)
                    {
                        ApplicationArea = All;
                        ShowCaption = false;
                    }
                }
                group(Column2)
                {
                    ShowCaption = false;
                    field(Balance; Rec."Balance (LCY)")
                    {
                        ApplicationArea = All;
                        ShowCaption = false;
                    }
                }
            }
        }
    }
}
